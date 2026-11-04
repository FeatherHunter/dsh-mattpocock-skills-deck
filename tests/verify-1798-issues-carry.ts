#!/usr/bin/env node
/**
 * tests/verify-1798-issues-carry.ts —— 来源不完整时，顶层未挂图票也必须「只补不删」（#1798）。
 *
 * 治的是什么：快照每趟都从后端列表重新组装 issues（没挂到任何地图的顶层票）。列表被截断
 * （GitHub 分页 / GitLab 第一页）或掉到 REST 通道时，页面之外的行这一趟根本没见到；旧实现
 * 只看这一趟的列表，于是仍然存在的票被静默从面板上删掉。更刺眼的是计数：同一趟里计数还会
 * 沿用上次已知（#1698 的 previous-known），数字说还有，列表里却没有，用户看到的是一份自相矛盾
 * 的快照。
 *
 * #1774 已经把「地图容器与它的子票」接上了只补不删；这张票把同一条口径接到 issues 这条路上：
 *   · 只有来源不完整（sourceComplete === false）且上一份快照存在时才补；
 *   · 按池内身份去重（同号 PR 与普通工单各算一行），本次结果优先；
 *   · 整行沿用上一份的值，不按字段拼（这一趟没见到，分不清哪一格是真变了、哪一格是没取到）；
 *   · 不把已关闭容器里的已关闭子票（瘦身行）复活成顶层行；
 *   · 补回行仍要过「已挂到地图」过滤，同一张票不能同时出现在 maps[].tickets 与 issues。
 *
 * 覆盖：
 *   A. 纯组装：补回缺失的顶层行、整行沿用旧值、来源完整照旧删行、无上一份不凭空造行、
 *      同号 PR/issue 各留一行、本次优先、瘦身行不复活、已挂图过滤、升格成容器的行不重复、
 *      未知/异常池内身份各算一行、不改入参。
 *   B. 编排层：每趟新建编排器（与生产同形），第二趟显式传 previousSnapshot 才有补回；
 *      不传时旧行为当场现形；来源恢复完整后补回的旧行被删掉。
 *   C. 快照电话路：连续多次 handleSnapshot，截断趟补回、恢复完整趟删行。
 *   D. 刷新电话路：连续多次 handleRefresh，同上。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1798-issues-carry.ts
 */
// 门禁归属: src/host/tracker/snapshot.ts
// 门禁归属: src/host/tracker/snapshotAssemble.ts
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/session-refresh-schedule.ts
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
function clone(v: any): any { return JSON.parse(JSON.stringify(v)) }

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
function issueTitles(snap: any): string[] {
  return (snap && Array.isArray(snap.issues) ? snap.issues : []).map(function (r: any) { return String(r && r.title) }).sort()
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
// 以下假 deps 的形状照 verify-1774-carry-wiring.ts 的 roomDeps / refreshDeps 抄（那扇是独立脚本，
// 被 import 就会整篇跑起来，所以只能照形状写，不能直接 import 它的构造器）。
async function roomDeps(table: any, tracker: any) {
  const adopt = function (s: unknown, c: string) { table.setCache({ ts: Date.now(), snapshot: s, error: null, cwd: c }); return s }
  const d: any = {
    canonicalKey: async function (x: string) { return 'K1798' },
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
    DEFAULT_CWD: 'K1798',
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
  // #1870：刷新这一路要的「上一份快照」只从本地快照库回放里取（宿主内存那份不再参与显示）。
  // 门禁里用同一张表模拟库：上一趟采纳进表里的那份就是库里的回放。
  d.getSnapshotLibrary = async function () {
    return {
      readSnapshotReplay: async function (input: any) {
        const e = table.getCache(input && input.workspaceRoot)
        return (e && e.snapshot) ? { snapshot: e.snapshot, lastKnownAtMs: e.ts } : null
      },
      recordIssueRows: async function () { return { ok: true, rows: 0, mergeVersion: null } },
      readSnapshotDiagnostics: async function () { return [] },
    }
  }
  return d
}

async function main() {
  const asm = await import(url('src/host/tracker/snapshotAssemble.ts'))
  const snapMod = await import(url('src/host/tracker/snapshot.ts'))
  const snapRoomMod = await import(url('src/refresh/rooms/host/session-snapshot-cache.ts'))
  const refRoomMod = await import(url('src/refresh/rooms/host/session-refresh-schedule.ts'))
  const assemble = function (rows: any[]) { return asm.assembleSnapshot(REF, rows) }
  const carry = function (prev: any, rows: any[], sourceComplete: boolean) {
    return asm.carryOverMapTickets(prev, assemble(rows), { sourceComplete: sourceComplete })
  }

  title('A) 纯组装：来源不完整时补回上次已知的顶层未挂图票')
  {
    // A1：上次有顶层票 10/11/12，这一趟列表只剩 10（第 11、12 行被页码边界切掉）。
    //     期望：三行都在，缺失行整行沿用上次的值（不是只补编号），本次已有的 10 排在前面。
    const prevRows = [row('10'), row('11', { body: 'BODY-11', url: 'u11', labels: ['x'] }), row('12', { body: 'BODY-12' })]
    const prev = carry(null, prevRows, true)
    const nextInput = assemble([row('10', { title: 'T10-new' })])
    const next = asm.carryOverMapTickets(prev, nextInput, { sourceComplete: false })
    check(keysOf(next.issues).join(',') === '10,11,12', '截断那趟：三行都在（本次的 10 + 上次已知的 11/12）', show(keysOf(next.issues)))
    check(next.issues.length === 3 && next.issues[0].key === '10', '本次结果优先：这三行里 10 排在最前（没有被旧行盖掉顺序）', show(keysOf(next.issues)))
    const r11 = next.issues.filter(function (r: any) { return String(r.key) === '11' })[0]
    const p11 = prev.issues.filter(function (r: any) { return String(r.key) === '11' })[0]
    check(!!r11 && show(r11) === show(p11), '缺失行整行沿用上一份的值（正文、URL、标签一个不丢）', show(r11))
    const r10 = next.issues.filter(function (r: any) { return String(r.key) === '10' })[0]
    check(!!r10 && r10.title === 'T10-new', '本次已有的行用本次的值（不拿旧行覆盖）', show(r10))
    const dupes = next.issues.map(function (r: any) { return String(r.key) }).filter(function (k: string, i: number, arr: string[]) { return arr.indexOf(k) !== i })
    check(dupes.length === 0, '补回后没有重复行', show(dupes))
  }
  {
    // A2：同样的输入，但来源完整 —— 完整来源以本次为准，11/12 必须被删掉。
    const prev = carry(null, [row('10'), row('11'), row('12')], true)
    const next = carry(prev, [row('10')], true)
    check(keysOf(next.issues).join(',') === '10', '来源完整时缺失的 11/12 被删（不许拿旧数据赖着）', show(keysOf(next.issues)))
  }
  {
    // A3：没有上一份快照 —— 不凭空造行（与地图容器补回同一条边界）。
    const next = carry(null, [row('10')], false)
    check(keysOf(next.issues).join(',') === '10', '没有上一份快照时只留这一趟见到的行', show(keysOf(next.issues)))
  }
  {
    // A4：同一个编号的普通工单与拉取请求各算一行；这一趟只剩工单，PR 行要单独补回。
    const prev = carry(null, [row('20'), row('20', { isPullRequest: true, title: 'PR20' })], true)
    const next = carry(prev, [row('20')], false)
    const prs = next.issues.filter(function (r: any) { return r && r.isPullRequest === true })
    const plain = next.issues.filter(function (r: any) { return r && r.isPullRequest === false })
    check(plain.length === 1 && prs.length === 1, '同号 PR 与普通工单各留一行（按池内身份，不按编号合并）', show(next.issues.map(function (r: any) { return [r.key, r.isPullRequest] })))
    check(prs.length === 1 && String(prs[0].title) === 'PR20', '补回的就是那一行 PR（整行沿用旧值）', show(prs[0]))
  }
  {
    // A5：已关闭容器里已关闭的子票只留瘦身行（#1291），上次它若在 issues 里也不许复活成顶层行。
    const prevRows = [row('31', { state: 'CLOSED' })]
    const prev = carry(null, prevRows, true)
    const nextRows = [mapRow('40', { state: 'CLOSED' }), childRow('31', '40', { state: 'CLOSED' })]
    const next = asm.carryOverMapTickets(prev, assemble(nextRows), { sourceComplete: false })
    check(keysOf(next.issues).length === 0, '已关闭容器里的已关闭子票不从上一份 issues 复活', show(keysOf(next.issues)))
    const thin = (next.thinTickets || []).filter(function (t: any) { return String(t.key) === '31' })
    check(thin.length === 1, '它仍然只以瘦身行的身份存在（供工作路线查标题）', show((next.thinTickets || []).map(function (t: any) { return t.key })))
    check(!!mapByKey(next, '40'), '容器 40 按现行口径保留', show(keysOf(next.maps)))
  }
  {
    // A6：补回的行仍要经过「已挂到地图」过滤。构造上一份里同一张票同时在 issues 与容器子票里
    //     （正常装配产不出这种形状，但补回逻辑不能因此把重复行带上首屏），这一趟容器还在、子票被借回。
    const prev: any = {
      maps: [{ key: '60', type: 'map', state: 'OPEN', tickets: [row('50')], stats: { total: 1 } }],
      issues: [row('50')],
      thinTickets: [],
    }
    const next = asm.carryOverMapTickets(prev, assemble([mapRow('60')]), { sourceComplete: false })
    check(keysOf(next.issues).length === 0, '已挂到地图的行不会同时出现在 issues（补回行也过这道过滤）', show(keysOf(next.issues)))
    check(!!mapByKey(next, '60') && keysOf(mapByKey(next, '60').tickets).join(',') === '50', '那张票仍在容器子票里', show(mapByKey(next, '60') && keysOf(mapByKey(next, '60').tickets)))
  }
  {
    // A7：不修改入参快照 —— 上一份与这一趟装配出来的快照都必须原样不动。
    const prev = carry(null, [row('10'), row('11')], true)
    const nextInput = assemble([row('10')])
    const prevBefore = clone(prev)
    const nextBefore = clone(nextInput)
    asm.carryOverMapTickets(prev, nextInput, { sourceComplete: false })
    check(show(prev) === show(prevBefore), '调用后上一份快照原样不动', show(prev))
    check(show(nextInput) === show(nextBefore), '调用后这一趟装配结果原样不动', show(nextInput))
  }
  {
    // A8：上次它还是顶层未挂图票，这一趟升格成了容器（map/spec）——容器行在 maps 里，
    //     issues 是「未挂到地图」的清单；补回旧行会让同一张票两处出现（deck-derive 把 issues 当孤儿票）。
    const prev = carry(null, [row('50')], true)
    const next = asm.carryOverMapTickets(prev, assemble([mapRow('50')]), { sourceComplete: false })
    check(keysOf(next.issues).length === 0, '升格为容器的行不以 issues 行补回（同一张票不许两处出现）', show(keysOf(next.issues)))
    check(keysOf(next.maps).join(',') === '50', '它仍在 maps 里作为容器', show(keysOf(next.maps)))
  }
  {
    // A9：池内身份未知（isPullRequest 缺失）或异常（非布尔）时沿用既有隔离口径：身份键不同就各算一行，
    //     不能被「同编号」合并掉。上一份 70 的两行身份分别是 MISSING 与 BAD，这一趟只有正规 issue 70。
    const missing = row('70')
    delete missing.isPullRequest
    const prev = carry(null, [missing, row('70', { isPullRequest: 'bad' })], true)
    const next = carry(prev, [row('70')], false)
    const identities = next.issues.map(function (r: any) {
      if (!Object.prototype.hasOwnProperty.call(r, 'isPullRequest')) return 'missing'
      return r.isPullRequest === true ? 'pr' : (r.isPullRequest === false ? 'issue' : 'bad')
    }).sort().join(',')
    check(identities === 'bad,issue,missing', '未知/异常种类按池内身份各留一行（不被编号合并）', identities)
  }

  title('B) 编排层：每趟新建编排器（与生产同形），上一份快照由调用方显式传入')
  {
    const tracker = makeTracker([{ rows: [row('10'), row('11')] }, { rows: [row('10')], truncated: true }])
    const reg = { get: function () { return tracker }, describe: function () { return REF }, modules: function () { return [] } }
    const ctx = {}
    const c1 = snapMod.createSnapshotComposer(reg)
    const r1 = await c1.composeSnapshot('github', REF, ctx, { force: true })
    check(r1.ok === true && keysOf(r1.snapshot.issues).join(',') === '10,11', '第一趟完整来源：顶层票 10/11 都在', show(r1.ok ? keysOf(r1.snapshot.issues) : r1.error))
    const s1 = r1.snapshot
    // 第二趟：新实例（生产的形状），显式传上一份快照 + 列表截断。
    const c2 = snapMod.createSnapshotComposer(reg)
    const r2 = await c2.composeSnapshot('github', REF, ctx, { force: true, previousSnapshot: s1 })
    check(keysOf(r2.snapshot.issues).join(',') === '10,11', '截断那趟：缺失的 11 从上一份快照补回', show(keysOf(r2.snapshot.issues)))
    // 反证：同样的新实例但不传上一份快照 —— 旧行为当场现形（11 消失）。
    const c3 = snapMod.createSnapshotComposer(reg)
    const r3 = await c3.composeSnapshot('github', REF, ctx, { force: true })
    check(keysOf(r3.snapshot.issues).join(',') === '10', '反证：不传上一份快照时 11 消失（这正是修复前的现场）', show(keysOf(r3.snapshot.issues)))
    // 来源恢复完整：同样传上一份快照，11 必须被删掉（只补不删只限不完整来源）。
    tracker.list = async function () { return { ok: true, data: [row('10')] } }
    const c4 = snapMod.createSnapshotComposer(reg)
    const r4 = await c4.composeSnapshot('github', REF, ctx, { force: true, previousSnapshot: r2.snapshot })
    check(keysOf(r4.snapshot.issues).join(',') === '10', '来源恢复完整后 11 被删（不拿旧行赖着）', show(keysOf(r4.snapshot.issues)))
  }

  title('C) 快照电话路（wf.snapshot）：截断趟补回顶层行，恢复完整趟删行')
  {
    const table = makeTable()
    const tracker = makeTracker([{ rows: [row('10'), row('11')] }, { rows: [row('10')], truncated: true }, { rows: [], truncated: true }])
    const h = snapRoomMod.createSessionSnapshot(await roomDeps(table, tracker))
    const r1 = await h.handleSnapshot({ cwd: 'K1798', force: true })
    check(keysOf(r1.issues).join(',') === '10,11', '第一趟完整来源：顶层票 10/11 都在', show(keysOf(r1.issues)))
    const r2 = await h.handleSnapshot({ cwd: 'K1798', force: true })
    check(keysOf(r2.issues).join(',') === '10,11', '第二趟截断：缺失的 11 从上一份快照补回', show(keysOf(r2.issues)))
    check(!!r2.deck && r2.deck.partial === true, '第二趟截断：仓库级 deck.partial 为真（清单可能不全）', show(r2.deck && r2.deck.partial))
    const r3 = await h.handleSnapshot({ cwd: 'K1798', force: true })
    check(keysOf(r3.issues).join(',') === '10,11', '第三趟整页都没回来：10/11 都从上一份补齐', show(keysOf(r3.issues)))
    // 来源恢复完整，且列表里确实没有 11 —— 这时以本次为准，11 应当被删掉。
    tracker.list = async function () { return { ok: true, data: [row('10')] } }
    const r4 = await h.handleSnapshot({ cwd: 'K1798', force: true })
    check(keysOf(r4.issues).join(',') === '10', '来源恢复完整后 11 被删（只补不删只限不完整来源）', show(keysOf(r4.issues)))
  }

  title('D) 刷新电话路（wf.refresh）：截断趟补回顶层行，恢复完整趟删行')
  {
    const table = makeTable()
    const tracker = makeTracker([{ rows: [row('10'), row('11')] }, { rows: [row('10')], truncated: true }, { rows: [], truncated: true }])
    const h = refRoomMod.createSessionRefresh(await refreshDeps(table, tracker))
    const r1 = await h.handleRefresh({ cwd: 'K1798' })
    check(keysOf(r1.issues).join(',') === '10,11', '第一趟完整来源：顶层票 10/11 都在', show(keysOf(r1.issues)))
    const r2 = await h.handleRefresh({ cwd: 'K1798' })
    check(keysOf(r2.issues).join(',') === '10,11', '第二趟截断：缺失的 11 从上一份快照补回', show(keysOf(r2.issues)))
    check(!!r2.deck && r2.deck.partial === true, '第二趟截断：仓库级 deck.partial 为真', show(r2.deck && r2.deck.partial))
    const r3 = await h.handleRefresh({ cwd: 'K1798' })
    check(keysOf(r3.issues).join(',') === '10,11', '第三趟整页都没回来：10/11 都从上一份补齐', show(keysOf(r3.issues)))
    tracker.list = async function () { return { ok: true, data: [row('10')] } }
    const r4 = await h.handleRefresh({ cwd: 'K1798' })
    check(keysOf(r4.issues).join(',') === '10', '来源恢复完整后 11 被删（只补不删只限不完整来源）', show(keysOf(r4.issues)))
  }

  console.log('\n=== 汇总 ===')
  console.log(total + ' 条判据，' + (broken.length ? broken.length + ' 条不变式破了' : '全部守住'))
  if (broken.length) { console.log('\n破了的不变式：'); for (const b of broken) console.log('  ' + b); process.exit(1) }
  console.log('全部通过 ✅ — 来源不完整不再静默删掉顶层未挂图票')
}

main().catch(function (e) { console.error('RUNNER ERROR:', (e && e.stack) || e); process.exit(2) })
