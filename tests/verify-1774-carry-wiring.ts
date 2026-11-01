#!/usr/bin/env node
/**
 * tests/verify-1774-carry-wiring.ts —— 地图容器掉出列表时，快照重建必须保住容器与它的子票（#1774）。
 *
 * 治的是什么：GitLab（以及任何会截断列表的后端）票数过百时只回第一页。上一次快照里还在的地图容器
 * 如果这一页里没有，旧实现会「这次没见到的容器就当它没了」：容器行与它已归一的子票一起消失，
 * 子票还会以孤儿身份漏进 issues，面板上地图与票数都对不上。
 * 同时还有一条更隐蔽的断路：编排层（src/host/tracker/snapshot.ts）只从自己进程内的快照缓存里
 * 取「上次快照」，而两条生产电话路（wf.snapshot / wf.refresh）每次请求都新建一个编排器实例，
 * 那份缓存永远是空的 —— 补回上次已知的逻辑在生产上从来没拿到过上次快照。
 *
 * 这张票把两段接起来：
 *   一、编排层接受调用方显式传入的 previousSnapshot（会议室里的内存缓存就是它）；
 *   二、纯组装层在来源不完整时，把「上次有、这次缺席」的容器并回 maps，并把已经漏进 issues 的
 *       子票按父键搬回容器（只补不删；完整来源照旧删缩）。
 *
 * 覆盖：
 *   A. 纯组装：截断时容器保留、子票补回、计数不缩水、carry 标记写出；完整来源照旧删除；
 *      已关闭容器按现行口径保留且子票为空；没有上次快照时不凭空造容器。
 *   B. 编排层：每次新建编排器（与生产同形），第二趟显式传 previousSnapshot 才有补回；
 *      不传时旧行为当场现形（容器消失、子票漏进 issues）—— 证明这条接线是承重的。
 *   C. 快照电话路：连续两次 handleSnapshot，第二趟列表截断，容器与子票仍在、issues 不重复。
 *   D. 刷新电话路：连续两次 handleRefresh，同上。
 *   E. 上一份快照的归属核对：别的后端 / 别的仓库的上一份快照不拿来补。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1774-carry-wiring.ts
 */
// 门禁归属: src/host/tracker/snapshot.ts
// 门禁归属: src/host/tracker/snapshotAssemble.ts
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/session-refresh-schedule.ts
const fsx = require('fs')
const nodePath = require('path')
const nodeOs = require('os')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const url = (rel: string) => pathToFileURL(nodePath.join(ROOT, rel)).href
const quiet = { fire: () => {}, isEnabled: () => false }
const PLATFORM = { os: 'win32', path: nodePath, async getHome() { return nodeOs.homedir() } }

let total = 0
const broken: string[] = []
function check(ok: boolean, msg: string, detail?: string): void {
  total++
  if (ok) { console.log('  PASS ' + msg); return }
  const line = '  FAIL 不变式破了 —— ' + msg + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t: string): void { console.log('\n' + t) }
function show(v: unknown): string { try { return JSON.stringify(v) } catch (e) { return String(v) } }

const REF = { backend: 'github', refId: 'a/b', name: 'a/b', url: '' }
function row(key: string, extra?: Record<string, unknown>) {
  return Object.assign({ key: key, number: Number(key), title: 'T' + key, state: 'OPEN', body: '', isPullRequest: false, parentKey: null as unknown }, extra || {})
}
function mapRow(key: string, extra?: Record<string, unknown>) { return row(key, Object.assign({ type: 'map' }, extra || {})) }
function childRow(key: string, parent: string, extra?: Record<string, unknown>) { return row(key, Object.assign({ parentKey: parent }, extra || {})) }
function mapByKey(snap: any, key: string): any {
  const list = (snap && Array.isArray(snap.maps)) ? snap.maps : []
  return list.filter(function (m: any) { return m && String(m.key) === key })[0] || null
}
function keysOf(list: any[]): string[] {
  return (Array.isArray(list) ? list : []).map(function (x: any) { return x && x.key != null ? String(x.key) : '' }).sort()
}
// 列表桩：按调用顺序回不同的行，第二趟起可以标 truncated（模拟后端只回第一页）。
function makeTracker(steps: Array<{ rows: any[]; truncated?: boolean }>) {
  let call = 0
  return {
    calls: () => call,
    list: async function () {
      const s = steps[Math.min(call, steps.length - 1)]
      call++
      const out: any = { ok: true, data: (s.rows || []).map(function (r: any) { return Object.assign({}, r) }) }
      if (s.truncated === true) out.truncated = true
      return out
    },
    counts: async function () { return { ok: false, error: { kind: 'unsupported' } } },
  }
}
function makeTable() {
  const m = new Map<string, any>()
  return {
    getCache: function (cwd: string) { return m.get(String(cwd)) || { ts: 0, snapshot: null, error: null, cwd: String(cwd) } },
    setCache: function (v: any) { if (v && v.cwd) m.set(String(v.cwd), v) },
  }
}
// 以下假 deps 的形状照 verify-729-force-dedup.ts 的 snapDeps 与 verify-696-shared-cache.ts 的会话假件抄。
// 那两扇门禁是独立脚本，被 import 就会整篇跑起来，所以只能照形状写，不能直接 import 它们的构造器。
async function roomDeps(table: any, tracker: any) {
  const adopt = function (s: unknown, c: string) { table.setCache({ ts: Date.now(), snapshot: s, error: null, cwd: c }); return s }
  const d: any = {
    canonicalKey: async function (x: string) { return 'K1774' },
    selectEarly: async function (o: any) { return { backendId: (o && o.backendId) || 'github', source: 'auto', rev: 0 } },
    isComposerSelection: function () { return true },
    getTrackerRegistry: async function () {
      return {
        modules: function () { return [] },
        describe: function () { return REF },
        get: function () { return tracker },
      }
    },
    getPlatform: async function () { return PLATFORM },
    ctx: { get: function () { return undefined } },
    getCache: table.getCache, setCache: table.setCache, CACHE_MS: 60000,
    cacheSnapshotIsCurrent: async function () { return null },
    upcaseSnapStates: function (s: any) { return s },
    computeLevels: function () { return { byNumber: {}, byKey: {} } },
    groupTickets: function (tickets: any[]) {
      const list = Array.isArray(tickets) ? tickets : []
      return {
        total: list.length,
        open: list.filter(function (t: any) { return String(t && t.state).toUpperCase() !== 'CLOSED' }).length,
        closed: list.filter(function (t: any) { return String(t && t.state).toUpperCase() === 'CLOSED' }).length,
        frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {},
      }
    },
    getRepoRoot: async function (c: string) { return c },
    getRepoKey: async function () { return { owner: 'a', name: 'b' } },
    readDiskCache: async function () { return null },
    writeDiskCache: async function () {},
    adoptSnapshot: adopt,
    detectionExec: async function () { return { ok: false } },
    getGhPath: function () { return '' }, getGhLastError: function () { return '' },
    errText: function (e: any) { return String((e && e.message) || e) },
    DEFAULT_CWD: 'K1774',
    logCtx: quiet,
  }
  return d
}
async function refreshDeps(table: any, tracker: any) {
  const d: any = await roomDeps(table, tracker)
  d.resetGhCache = function () {}
  const envMod = await import(url('src/host/snapshotEnvelope.ts'))
  const adopt = function (s: unknown, c: string) { table.setCache({ ts: Date.now(), snapshot: s, error: null, cwd: c }); return s }
  d.envelope = envMod.createSnapshotEnvelope({ getGhPath: function () { return '' }, getGhLastError: function () { return '' }, adoptSnapshot: adopt, logCtx: quiet })
  return d
}
// 完整一趟：容器 2001 + 三张子票；截断一趟：只剩子票 2002（第一页边界上正好被切断的样子）。
const FULL_ROWS = [mapRow('2001'), childRow('2002', '2001'), childRow('2003', '2001'), childRow('2004', '2001')]
const TRUNC_ROWS = [childRow('2002', '2001')]

async function main() {
  const asm = await import(url('src/host/tracker/snapshotAssemble.ts'))
  const snapMod = await import(url('src/host/tracker/snapshot.ts'))
  const snapRoomMod = await import(url('src/refresh/rooms/host/session-snapshot-cache.ts'))
  const refRoomMod = await import(url('src/refresh/rooms/host/session-refresh-schedule.ts'))

  title('A) 纯组装：来源不完整时保住上次的容器与子票')
  {
    // A1：上次完整（容器 2001 + 子票 2002/2003/2004），这次截断只剩子票 2002。
    //     期望：容器还在、三张子票都在、计数 3、带 carry 标记、issues 不重复。
    const prev = asm.carryOverMapTickets(null, asm.assembleSnapshot(REF, FULL_ROWS), { sourceComplete: true })
    const next = asm.carryOverMapTickets(prev, asm.assembleSnapshot(REF, TRUNC_ROWS), { sourceComplete: false })
    const m = mapByKey(next, '2001')
    check(!!m, '截断那一趟容器 2001 仍在快照里', show(keysOf(next.maps)))
    check(!!m && Array.isArray(m.tickets) && m.tickets.length === 3, '容器子票补回三张（不是只剩这次见到的一张）', show(m && m.tickets && m.tickets.length))
    check(!!m && keysOf(m.tickets).join(',') === '2002,2003,2004', '补回的子票就是上次那三张', show(m && keysOf(m.tickets)))
    check(!!m && m.stats && m.stats.total === 3, '容器计数不缩水（stats.total=3）', show(m && m.stats))
    check(!!m && !!m.carry && m.carry.kept === 2 && typeof m.carry.at === 'number', '补回留下 carry 标记（kept=2、带时刻）', show(m && m.carry))
    check(Array.isArray(next.issues) && next.issues.length === 0, '补回的子票不再以孤儿身份出现在 issues', show(keysOf(next.issues)))
  }
  {
    // A2：上次容器 3001 带子票 3002/3003；这次列表里只有子票 3003（容器自己被第一页切掉）。
    //     期望：容器 3001 保回来，3003 从 issues 搬回容器，issues 清空。
    const prevRows = [mapRow('3001'), childRow('3002', '3001'), childRow('3003', '3001')]
    const prev = asm.carryOverMapTickets(null, asm.assembleSnapshot(REF, prevRows), { sourceComplete: true })
    const next = asm.carryOverMapTickets(prev, asm.assembleSnapshot(REF, [childRow('3003', '3001')]), { sourceComplete: false })
    const m = mapByKey(next, '3001')
    check(!!m, '缺席的容器 3001 按上次已知补回', show(keysOf(next.maps)))
    check(!!m && keysOf(m.tickets).join(',') === '3002,3003', '这次见到的 3003 归回容器，上次已知 3002 也保留', show(m && keysOf(m.tickets)))
    check(Array.isArray(next.issues) && next.issues.length === 0, '3003 不再同时挂在 issues 里（一处只出现一次）', show(keysOf(next.issues)))
  }
  {
    // A3：同样的输入但来源完整 —— 完整来源仍以这次为准删缩，不许拿旧容器赖着不走。
    const prevRows = [mapRow('3001'), childRow('3002', '3001')]
    const prev = asm.carryOverMapTickets(null, asm.assembleSnapshot(REF, prevRows), { sourceComplete: true })
    const next = asm.carryOverMapTickets(prev, asm.assembleSnapshot(REF, [childRow('3003', '3001')]), { sourceComplete: true })
    check(!mapByKey(next, '3001'), '来源完整时容器 3001 被删（不拿旧数据赖着）', show(keysOf(next.maps)))
    check(Array.isArray(next.issues) && keysOf(next.issues).join(',') === '3003', '来源完整时 3003 照常作为未挂图票留在 issues', show(keysOf(next.issues)))
  }
  {
    // A4：已关闭容器按现行口径保留，子票清单收空且不写 carry（它不是「补回数据」，是容器行本身）。
    const prevRows = [mapRow('4001', { state: 'CLOSED' }), childRow('4002', '4001', { state: 'CLOSED' })]
    const prev = asm.carryOverMapTickets(null, asm.assembleSnapshot(REF, prevRows), { sourceComplete: true })
    const next = asm.carryOverMapTickets(prev, asm.assembleSnapshot(REF, []), { sourceComplete: false })
    const m = mapByKey(next, '4001')
    check(!!m, '已关闭容器 4001 也保留（用户仍能看到这个历史容器）', show(keysOf(next.maps)))
    check(!!m && Array.isArray(m.tickets) && m.tickets.length === 0, '已关闭容器的子票按现行口径为空', show(m && m.tickets && m.tickets.length))
    check(!!m && !m.carry, '已关闭容器不写 carry 标记', show(m && m.carry))
  }
  {
    // A5：没有上次快照时不凭空造容器。
    const next = asm.carryOverMapTickets(null, asm.assembleSnapshot(REF, TRUNC_ROWS), { sourceComplete: false })
    check(Array.isArray(next.maps) && next.maps.length === 0, '没有上次快照时不凭空造容器', show(keysOf(next.maps)))
    check(keysOf(next.issues).join(',') === '2002', '没有上次快照时子票照常留在 issues', show(keysOf(next.issues)))
  }

  title('B) 编排层：每趟新建编排器（与生产同形），上一份快照由调用方显式传入')
  {
    const tracker = makeTracker([{ rows: FULL_ROWS }, { rows: TRUNC_ROWS, truncated: true }])
    const reg = { get: function () { return tracker }, describe: function () { return REF }, modules: function () { return [] } }
    const ctx = {}
    // 第一趟：完整来源，拿到一份「上次快照」。
    const c1 = snapMod.createSnapshotComposer(reg)
    const r1 = await c1.composeSnapshot('github', REF, ctx, { force: true })
    check(r1.ok === true && !!r1.snapshot, '编排层第一趟重建成功', show(r1 && r1.error))
    const s1 = r1.snapshot
    check(!!mapByKey(s1, '2001') && mapByKey(s1, '2001').tickets.length === 3, '第一趟完整来源：容器 2001 带三张子票', show(s1 && keysOf(s1.maps)))
    // 第二趟：新实例（生产的形状），显式传上一份快照 + 列表截断。
    const c2 = snapMod.createSnapshotComposer(reg)
    const r2 = await c2.composeSnapshot('github', REF, ctx, { force: true, previousSnapshot: s1 })
    const m2 = mapByKey(r2.snapshot, '2001')
    check(!!m2, '显式传入上一份快照后，截断那一趟容器 2001 仍被补回', show(r2.snapshot && keysOf(r2.snapshot.maps)))
    check(!!m2 && m2.tickets.length === 3 && m2.stats && m2.stats.total === 3, '补回后子票三张、计数 3', show(m2 && m2.stats))
    check(!!m2 && !!m2.carry, '补回带上 carry 标记', show(m2 && m2.carry))
    check(keysOf(r2.snapshot.issues).length === 0, '补回的子票不再出现在 issues', show(keysOf(r2.snapshot.issues)))
    // 截断那趟后端 counts 不可用、行也不全：计数必须沿用第一趟的「上次已知」，不许缩水（#1698 口径）。
    const dec2 = r2.snapshot.deck && r2.snapshot.deck.counts
    check(!!dec2 && dec2.source === 'previous-known' && dec2.total === 3, '截断那趟计数沿用上次已知（previous-known、total=3）', show(dec2))
    // 反证：同样的新实例但不传上一份快照 —— 旧行为当场现形（容器消失、子票漏进 issues）。
    // 这一条不是要它红，而是钉住「上一份快照必须由调用方传进来」这条接线是承重的。
    const c3 = snapMod.createSnapshotComposer(reg)
    const r3 = await c3.composeSnapshot('github', REF, ctx, { force: true })
    check(Array.isArray(r3.snapshot.maps) && r3.snapshot.maps.length === 0, '反证：不传上一份快照时容器 2001 直接消失（这正是修复前的现场）', show(r3.snapshot && keysOf(r3.snapshot.maps)))
    check(keysOf(r3.snapshot.issues).join(',') === '2002', '反证：不传时子票 2002 漏进 issues', show(keysOf(r3.snapshot.issues)))
  }

  title('C) 快照电话路（wf.snapshot）：第二趟截断，容器与子票仍保住')
  {
    const table = makeTable()
    const tracker = makeTracker([{ rows: FULL_ROWS }, { rows: TRUNC_ROWS, truncated: true }])
    const h = snapRoomMod.createSessionSnapshot(await roomDeps(table, tracker))
    const r1 = await h.handleSnapshot({ cwd: 'K1774', force: true })
    check(!!mapByKey(r1, '2001') && mapByKey(r1, '2001').tickets.length === 3, '第一趟完整来源：容器 2001 带三张子票', show(r1 && keysOf(r1.maps)))
    const r2 = await h.handleSnapshot({ cwd: 'K1774', force: true })
    const m2 = mapByKey(r2, '2001')
    check(!!m2, '第二趟截断：容器 2001 仍在快照里', show(r2 && keysOf(r2.maps)))
    check(!!m2 && m2.tickets.length === 3, '第二趟截断：三张子票一张不少', show(m2 && m2.tickets && m2.tickets.length))
    check(!!m2 && m2.stats && m2.stats.total === 3, '第二趟截断：容器计数仍是 3', show(m2 && m2.stats))
    check(!!m2 && !!m2.carry && typeof m2.carry.at === 'number', '第二趟截断：容器带 carry 标记（界面能说这是上次数据）', show(m2 && m2.carry))
    // 这条电话路的回包把「地图行 + 子票 + 未挂图票」摊平成一张列表交给客户端（见 session-snapshot-cache 的三段拼接），
    // 所以这里判的是「摊平后仍然一张不多一张不少」：容器只出现一次，三张子票各一次。
    check(keysOf(r2.issues).join(',') === '2001,2002,2003,2004', '第二趟截断：扁平列表仍是容器 + 三张子票，一张不多一张不少', show(keysOf(r2.issues)))
    const dec2 = r2.deck && r2.deck.counts
    check(!!dec2 && dec2.source === 'previous-known' && dec2.total === 3, '第二趟截断：列表计数沿用上次已知（previous-known、total=3）', show(dec2))
    // 第三趟：来源恢复完整，且列表里确实没有 2001 —— 这时以本次为准，容器应当被删掉。
    tracker.list = async function () { return { ok: true, data: [childRow('2002', '2001')] } }
    const r3 = await h.handleSnapshot({ cwd: 'K1774', force: true })
    check(!mapByKey(r3, '2001'), '来源恢复完整后容器 2001 被删（只补不删只限不完整来源）', show(r3 && keysOf(r3.maps)))
  }

  title('D) 刷新电话路（wf.refresh）：第二趟截断，容器与子票仍保住')
  {
    const table = makeTable()
    const tracker = makeTracker([{ rows: FULL_ROWS }, { rows: TRUNC_ROWS, truncated: true }])
    const h = refRoomMod.createSessionRefresh(await refreshDeps(table, tracker))
    const r1 = await h.handleRefresh({ cwd: 'K1774' })
    check(!!mapByKey(r1, '2001') && mapByKey(r1, '2001').tickets.length === 3, '第一趟完整来源：容器 2001 带三张子票', show(r1 && keysOf(r1.maps)))
    const r2 = await h.handleRefresh({ cwd: 'K1774' })
    const m2 = mapByKey(r2, '2001')
    check(!!m2, '第二趟截断：容器 2001 仍在快照里', show(r2 && keysOf(r2.maps)))
    check(!!m2 && m2.tickets.length === 3, '第二趟截断：三张子票一张不少', show(m2 && m2.tickets && m2.tickets.length))
    check(!!m2 && m2.stats && m2.stats.total === 3, '第二趟截断：容器计数仍是 3', show(m2 && m2.stats))
    check(!!m2 && !!m2.carry && typeof m2.carry.at === 'number', '第二趟截断：容器带 carry 标记', show(m2 && m2.carry))
    check(keysOf(r2.issues).join(',') === '2001,2002,2003,2004', '第二趟截断：扁平列表仍是容器 + 三张子票，一张不多一张不少', show(keysOf(r2.issues)))
    const dec2 = r2.deck && r2.deck.counts
    check(!!dec2 && dec2.source === 'previous-known' && dec2.total === 3, '第二趟截断：列表计数沿用上次已知（previous-known、total=3）', show(dec2))
  }

  title('E) 上一份快照的归属核对：别的后端 / 别的仓库不拿来补')
  {
    // 快照自带的身份：selection.backendId 与 repository.refId（生产上每一趟 buildSnap 都会写）。
    const match = { selection: { backendId: 'github' }, repository: { backend: 'github', refId: 'a/b' }, maps: [mapRow('2001')] }
    const same = snapMod.previousSnapshotFor(match, 'github', REF)
    check(same === match, '同后端同仓库的上一份快照照常采用', show(!!same))
    const otherBackend = Object.assign({}, match, { selection: { backendId: 'gitlab' } })
    check(snapMod.previousSnapshotFor(otherBackend, 'github', REF) === null, '别后端的上一份快照拒绝采用', show(snapMod.previousSnapshotFor(otherBackend, 'github', REF)))
    const otherRepo = Object.assign({}, match, { repository: { backend: 'github', refId: 'other/repo' } })
    check(snapMod.previousSnapshotFor(otherRepo, 'github', REF) === null, '别仓库的上一份快照拒绝采用', show(snapMod.previousSnapshotFor(otherRepo, 'github', REF)))
    const legacy = Object.assign({}, match, { selection: undefined, repository: undefined })
    check(snapMod.previousSnapshotFor(legacy, 'github', REF) === legacy, '两样身份都没带的老快照按兼容放行', show(!!snapMod.previousSnapshotFor(legacy, 'github', REF)))
    // 把归属核对接进真编排器再验一次：上一份来自 gitlab，这一趟在 github 且列表截断。
    const tracker = makeTracker([{ rows: FULL_ROWS }, { rows: TRUNC_ROWS, truncated: true }])
    const reg = { get: function () { return tracker }, describe: function () { return REF }, modules: function () { return [] } }
    const c1 = snapMod.createSnapshotComposer(reg)
    const r1 = await c1.composeSnapshot('github', REF, {}, { force: true })
    const foreign = Object.assign({}, r1.snapshot, { selection: { backendId: 'gitlab' }, repository: { backend: 'gitlab', refId: 'a/b' } })
    const c2 = snapMod.createSnapshotComposer(reg)
    const r2 = await c2.composeSnapshot('github', REF, {}, { force: true, previousSnapshot: foreign })
    check(Array.isArray(r2.snapshot.maps) && r2.snapshot.maps.length === 0, '编排层拒绝别后端的上一份快照：截断那趟不补容器', show(r2.snapshot && keysOf(r2.snapshot.maps)))
    check(keysOf(r2.snapshot.issues).join(',') === '2002', '被拒的上一份快照不会把子票搬回容器', show(keysOf(r2.snapshot.issues)))
    const decE = r2.snapshot.deck && r2.snapshot.deck.counts
    check(!decE || decE.source !== 'previous-known', '被拒的上一份快照不沿用它的计数', show(decE))
  }

  console.log('\n=== 汇总 ===')
  console.log(total + ' 条判据，' + (broken.length ? broken.length + ' 条不变式破了' : '全部守住'))
  if (broken.length) { console.log('\n破了的不变式：'); for (const b of broken) console.log('  ' + b); process.exit(1) }
  console.log('全部通过 ✅ — 容器掉出列表不再丢，编排层每趟都拿得到上一份快照')
}

main().catch(function (e) { console.error('RUNNER ERROR:', (e && e.stack) || e); process.exit(2) })
