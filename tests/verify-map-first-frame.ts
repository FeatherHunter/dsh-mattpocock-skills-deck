// tests/verify-map-first-frame.ts —— #1696 门禁：地图详情首帧显示快照已知的阻塞关系与计数
// 门禁归属: src/host/tracker/snapshotAssemble.ts
// 门禁归属: src/host/tracker/snapshot.ts
//
// 判据（票 #1696「这次做」逐条）：
// ① 快照里的地图子票行要能直接画：阻塞者编号是数字（客户端卡片只认数字/字符串），
//    「我挡住谁」由宿主反推，认领人从 assignees 取，票号、层级与分组计数一并算好。
//    这样地图详情首帧（还没有新查询回来）就能画出被挡关系与四枚计数，而不是等新查询。
// ② 宿主重建快照时不许把已知变空：列表被截断或走了 REST 降级（不完整来源）时，
//    上次快照里已知的子票行与计数要按编号补回来（只补不删）；只有完整来源才允许删/缩。
// ③ 已关闭容器首帧子票为空是现行口径（#691/#1291），这一条不改。
// ④ 被挂进地图的票不再在「未挂图票」里出现第二次（同一张票只画一处）。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-map-first-frame.ts
// 说明：本门禁测宿主侧（纯逻辑 + composeSnapshot 接线，不渲染 React）；真投影渲染由
//   verify-map-first-frame-freshness.ts 负责（文件名带 freshness，按 scripts/verify-stages.json 排在构建之后）。
import { printGateResult } from './lib/gate-result.ts'

const GATE = 'verify-map-first-frame'
let total = 0
let failed = 0
function check(ok: boolean, msg: string, detail?: unknown): void {
  total += 1
  if (ok) { console.log('  PASS ' + msg); return }
  failed += 1
  console.log('  FAIL ' + msg + (detail === undefined ? '' : ' — ' + String(detail).slice(0, 300)))
}

const asm = await import('../src/host/tracker/snapshotAssemble.ts')
const bodyParse = await import('../src/tracker/body-parse.ts')
const { createSnapshotComposer } = await import('../src/host/tracker/snapshot.ts')
const { carryOverMapTickets, normalizeMapTickets, mergeKnownTickets } = asm
const { createTicketGrouping } = await import('../src/host/ticketGrouping.ts')

/** 一行 Issue（宿主组装层只读这几格；形状与 GitHub 归一层的产出一致）。 */
function issue(key: string, extra?: Record<string, any>): any {
  return Object.assign({
    key, effortId: '', type: 'issue', title: '票 ' + key, state: 'OPEN', body: '正文 ' + key,
    url: 'https://example.test/issues/' + key, createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z', closedAt: null, parentKey: null,
    labels: [], assignees: [], blockedBy: [], comments: [],
  }, extra || {})
}
/** 一张容器行（探索地图 / 规格）。 */
function container(key: string, type: string, tickets: any[], extra?: Record<string, any>): any {
  return Object.assign({ key, number: Number(key), effortId: '', type, title: '容器 ' + key, state: 'OPEN', body: '', tickets }, extra || {})
}
function snapOf(maps: any[], issues?: any[]): any {
  return { maps, issues: issues || [], thinTickets: [] }
}
function ticketByKey(map: any, key: string): any {
  const list = Array.isArray(map.tickets) ? map.tickets : []
  for (const t of list) if (String(t.number) === key || String(t.key) === key) return t
  return null
}

// ---- A 组：子票行归一化（首帧能直接画关系与计数）----
{
  const rows = [
    issue('201', { blockedBy: [{ key: '301', title: '挡路的票' }] }),
    issue('202', { state: 'CLOSED', assignees: [{ login: 'alice' }] }),
    issue('301'),
  ]
  const map = container('100', 'map', rows)
  const out = carryOverMapTickets(null, snapOf([map]), { sourceComplete: true, nowMs: 1700000000000 })
  const m = out.maps[0]
  const t201 = ticketByKey(m, '201')
  check(!!t201, 'A1 子票行仍在容器里')
  check(!!t201 && t201.number === 201, 'A2 子票行补出数字票号（客户端卡片按编号找关系）', t201 && t201.number)
  check(!!t201 && Array.isArray(t201.blockedBy) && t201.blockedBy.length === 1 && t201.blockedBy[0] === 301,
    'A3 阻塞者从对象引用归一成数字（对象引用会让被挡关系静默消失）', t201 && JSON.stringify(t201.blockedBy))
  const t301 = ticketByKey(m, '301')
  check(!!t301 && Array.isArray(t301.blocks) && t301.blocks.length === 1 && t301.blocks[0] === 201,
    'A4 宿主反推「我挡住谁」，挡路卡才有红条可指', t301 && JSON.stringify(t301.blocks))
  const t202 = ticketByKey(m, '202')
  check(!!t202 && t202.claimedBy === 'alice', 'A5 认领人从 assignees 提到行上（卡片「在办」状态读它）', t202 && t202.claimedBy)
  check(!!t202 && t202.title === '票 202' && t202.body === '正文 202' && t202.url === 'https://example.test/issues/202',
    'A6 行上其它字段原样保留（标题/正文/链接不被归一化改掉）')
  const stats = m.stats || {}
  check(stats.total === 3 && stats.open === 2 && stats.closed === 1,
    'A7 容器计数从本次子票算好（首帧四枚计数不再等新查询）', JSON.stringify(stats))
  check(stats.frontier === 1 && stats.claimed === 0 && stats.blocked === 1,
    'A8 可接/占用/被挡三组计数同口径（201 被开着的 301 挡住；已关闭的 202 不算在办）', JSON.stringify(stats))
  check(!!t201 && typeof t201.level === 'number' && Array.isArray(stats.levels) && stats.levels.length >= 2,
    'A9 每票层级与分层计数一并带上（数据层有，V2 不画）', t201 && t201.level)
  check(!!t301 && Array.isArray(t301.blocks) && Array.isArray(t301.blockedBy) && t301.blockedBy.length === 0,
    'A10 没被挡的票 blockedBy 仍是空数组（不写成 undefined）')
  const blockedCase = carryOverMapTickets(null, snapOf([container('101', 'map', [issue('401', { blockedBy: [402] }), issue('402')])]), { sourceComplete: true })
  check((blockedCase.maps[0].stats || {}).blocked === 1, 'A11 本图内仍开着的阻塞者让票算作被挡', JSON.stringify(blockedCase.maps[0].stats))
  const closedBlocker = carryOverMapTickets(null, snapOf([container('102', 'map', [issue('501', { blockedBy: [502] }), issue('502', { state: 'CLOSED' })])]), { sourceComplete: true })
  check((closedBlocker.maps[0].stats || {}).blocked === 0 && (closedBlocker.maps[0].stats || {}).frontier === 1,
    'A12 阻塞者已关闭时这张票算可接（与 groupTickets 同口径）', JSON.stringify(closedBlocker.maps[0].stats))
}

// ---- B 组：完整来源允许删/缩，已关闭容器口径不变 ----
{
  const prev = snapOf([container('200', 'map', [issue('601'), issue('602'), issue('603')])])
  const next = snapOf([container('200', 'map', [issue('601')])])
  const out = carryOverMapTickets(prev, next, { sourceComplete: true })
  check(out.maps[0].tickets.length === 1, 'B1 完整来源以本次为准：上次有、本次没有的票可以消失（允许删）', out.maps[0].tickets.length)
  check((out.maps[0].stats || {}).total === 1, 'B2 完整来源的计数按本次算（不保留上次的多余数字）', JSON.stringify(out.maps[0].stats))
  const prevClosed = snapOf([container('210', 'map', [issue('611')], { state: 'CLOSED' })])
  const nextClosed = snapOf([container('210', 'map', [], { state: 'CLOSED' })])
  const outClosed = carryOverMapTickets(prevClosed, nextClosed, { sourceComplete: false })
  check(Array.isArray(outClosed.maps[0].tickets) && outClosed.maps[0].tickets.length === 0,
    'B3 已关闭容器首帧子票为空是现行口径，不完整来源也不复活', JSON.stringify(outClosed.maps[0].tickets))
}

// ---- C 组：不完整来源只补空缺（已知不许变空）----
{
  const prev = snapOf([container('300', 'map', [
    issue('701', { title: '上次标题', body: '上次正文', blockedBy: [{ key: '702' }], assignees: [{ login: 'bob' }] }),
    issue('702', { title: '挡路者' }),
    issue('703', { title: '上次独有' }),
  ])])
  const next = snapOf([container('300', 'map', [
    issue('701', { title: '新标题', body: '', blockedBy: [], assignees: [] }),
  ])])
  const out = carryOverMapTickets(prev, next, { sourceComplete: false, nowMs: 1700000001000 })
  const m = out.maps[0]
  check(m.tickets.length === 3, 'C1 不完整来源：本次没取到的已知子票要补回来（只补不删）', m.tickets.length)
  const t701 = ticketByKey(m, '701')
  check(!!t701 && t701.title === '新标题', 'C2 本次取到的行以本次为准（新标题覆盖旧标题）', t701 && t701.title)
  check(!!t701 && t701.body === '上次正文', 'C3 本次没表达的正文沿用上次已知（空字符串不当成新事实）', t701 && t701.body)
  check(!!t701 && Array.isArray(t701.blockedBy) && t701.blockedBy[0] === 702,
    'C4 本次没表达的阻塞边沿用上次已知（降级薄行不得清掉已知关系）', t701 && JSON.stringify(t701.blockedBy))
  check(!!t701 && t701.claimedBy === 'bob', 'C5 本次没表达的认领人沿用上次已知', t701 && t701.claimedBy)
  check(!!ticketByKey(m, '703'), 'C6 上次独有的票仍挂在容器下（清单未取不等于票没了）')
  check((m.stats || {}).total === 3, 'C7 不完整来源的计数不缩水', JSON.stringify(m.stats))
  check(!!m.carry && m.carry.at === 1700000001000 && m.carry.kept >= 2,
    'C8 补回来的行留痕（何时、补了几张），界面能说这是上次数据', m.carry && JSON.stringify(m.carry))
  check(m.carry && m.carry.kept === 2, 'C9 只把本次缺的票算作补回（701 有本次行，不算补回）', m.carry && m.carry.kept)
}

// ---- D 组：计数已知但清单未取时，计数不许被清单长度改小 ----
{
  const prev = snapOf([container('400', 'map', [issue('801')], { stats: { total: 19, open: 18, closed: 1, frontier: 3, claimed: 2, blocked: 4, levels: [{ level: 0, total: 19, open: 18, closed: 1 }], levelOf: { '801': 0 } } })])
  const next = snapOf([container('400', 'map', [], { stats: undefined })])
  const out = carryOverMapTickets(prev, next, { sourceComplete: false })
  const stats = out.maps[0].stats || {}
  check(stats.total === 19, 'D1 上次计数比清单大时保留已知计数（清单未取不显示成 0 张）', JSON.stringify(stats))
  check(out.maps[0].tickets.length === 1, 'D2 同时把上次已知的那张子票补回来', out.maps[0].tickets.length)
}

// ---- E 组：被挂进地图的票不再出现在未挂图票里 ----
{
  const child = issue('901', { parentKey: '500' })
  const next = snapOf([container('500', 'map', [issue('902')])], [issue('902'), issue('903')])
  const out = carryOverMapTickets(null, next, { sourceComplete: false })
  const keys = (out.issues || []).map((r: any) => String(r.key))
  check(keys.indexOf('902') === -1, 'E1 已挂进容器的票从「未挂图票」里移除（同一张票不画两处）', keys.join(','))
  check(keys.indexOf('903') !== -1, 'E2 真正没挂图的票仍留在未挂图票里', keys.join(','))
  const out2 = carryOverMapTickets(null, next, { sourceComplete: true })
  check((out2.issues || []).length === 1 && String(out2.issues[0].key) === '903',
    'E3 完整来源同样去重（两张清单不重叠）', (out2.issues || []).map((r: any) => r.key).join(','))
}

// ---- F 组：与真组装层拼起来（首帧快照的真实形状）----
{
  const rows = [
    issue('1010', { type: 'map', title: '探索地图', body: '## Destination\n去某处\n' }),
    issue('1011', { parentKey: '1010', blockedBy: [{ key: '1012' }] }),
    issue('1012', { parentKey: '1010' }),
    issue('1013', { parentKey: '1010', state: 'CLOSED' }),
    issue('1014', { title: '普通票' }),
  ]
  const assembled = asm.assembleSnapshot({ refId: 'o/r' }, rows)
  const mapRow = (assembled.maps || []).find((m: any) => String(m.key) === '1010')
  check(!!mapRow && Array.isArray(mapRow.tickets) && mapRow.tickets.length === 3,
    'F1 组装层把三张子票挂进容器（首帧快照的原料）', mapRow && (mapRow.tickets || []).length)
  const out = carryOverMapTickets(null, assembled, { sourceComplete: true })
  const firstFrameMap = (out.maps || []).find((m: any) => String(m.key) === '1010')
  check(!!firstFrameMap && (firstFrameMap.stats || {}).total === 3 && (firstFrameMap.stats || {}).closed === 1,
    'F2 首帧快照直接带容器计数（不用等 wf.mapTickets）', firstFrameMap && JSON.stringify(firstFrameMap.stats))
  const blockedRow = (firstFrameMap.tickets || []).find((t: any) => String(t.number) === '1011')
  check(!!blockedRow && blockedRow.blockedBy[0] === 1012 && typeof blockedRow.level === 'number',
    'F3 首帧子票行带数字阻塞者与层级（卡片首帧就能画被挡）', blockedRow && JSON.stringify({ b: blockedRow.blockedBy, lv: blockedRow.level }))
  check(!!firstFrameMap && (firstFrameMap.stats || {}).blocked === 1, 'F4 首帧计数里被挡 1 张', firstFrameMap && JSON.stringify(firstFrameMap.stats))
  const spec = rows[0]
  check(!!spec, 'F5 组装层仍把地图当容器')
}

// ---- G 组：纯函数不改输入 ----
{
  const prevMap = container('600', 'map', [issue('1001')])
  const nextMap = container('600', 'map', [issue('1001', { title: '新标题' })])
  const prev = snapOf([prevMap])
  const next = snapOf([nextMap])
  const before = JSON.stringify({ prev, next })
  carryOverMapTickets(prev, next, { sourceComplete: false })
  check(JSON.stringify({ prev, next }) === before, 'G1 合并是纯函数：不改调用方传进来的两份快照')
}

// ---- H 组：composeSnapshot 接线（重建快照时真的调了补回，而不是只有纯函数可用）----
// 这一段防的是「模块写好了、门禁也绿，但生产路径没接上」——纯函数再对，宿主不调用也白搭。
{
  let phase: 'full' | 'degraded' = 'full'
  const full = [
    issue('2001', { type: 'map', title: '探索地图' }),
    issue('2002', { parentKey: '2001', blockedBy: [{ key: '2003' }] }),
    issue('2003', { parentKey: '2001' }),
    issue('2004', { parentKey: '2001' }),
  ]
  const degraded = [
    issue('2001', { type: 'map', title: '探索地图' }),
    issue('2002', { parentKey: '2001', title: '子票 2002（降级）' }),
  ]
  const tracker = {
    list: async () => (phase === 'full'
      ? { ok: true, data: full }
      : { ok: true, data: degraded, fallback: 'rest', truncated: true }),
    counts: async () => ({ ok: true, data: { open: 3, closed: 0, total: 3 } }),
    getDependencies: async () => ({ ok: true, data: [] }),
  }
  const composer = createSnapshotComposer({ get: () => tracker }, {})
  const ref = { refId: 'o/r', owner: 'o', name: 'r' }
  const r1 = await composer.composeSnapshot('github', ref, { cwd: 'D:\\ws' }, { force: true })
  check(r1 && r1.ok === true && r1.snapshot && Array.isArray(r1.snapshot.maps), 'H1 composeSnapshot 在接好补回后照常出快照', r1 && r1.ok)
  const map1 = r1 && r1.snapshot && (r1.snapshot.maps || []).find((m: any) => String(m.key) === '2001')
  check(!!map1 && (map1.tickets || []).length === 3 && typeof (map1.tickets || [])[0].number === 'number',
    'H2 第一趟完整来源：容器子票已归一成首帧形状（数字票号）', map1 && (map1.tickets || []).length)
  phase = 'degraded'
  const r2 = await composer.composeSnapshot('github', ref, { cwd: 'D:\\ws' }, { force: true })
  const map2 = r2 && r2.snapshot && (r2.snapshot.maps || []).find((m: any) => String(m.key) === '2001')
  check(!!map2 && (map2.tickets || []).length === 3, 'H3 第二趟降级来源：上次已知子票被补回（不缩成 1 张）', map2 && (map2.tickets || []).length)
  check(!!map2 && (map2.stats || {}).total === 3, 'H4 降级重建后容器计数仍是 3（没有被降级结果改成 1）', map2 && JSON.stringify(map2.stats))
  const blocked2 = map2 && (map2.tickets || []).find((t: any) => String(t.number) === '2002')
  check(!!blocked2 && Array.isArray(blocked2.blockedBy) && blocked2.blockedBy[0] === 2003,
    'H5 降级结果没表达的阻塞边沿用上次已知（被挡关系不消失）', blocked2 && JSON.stringify(blocked2.blockedBy))
  check(!!r2 && typeof r2.version === 'string' && r2.version.length > 0 && r2.snapshot.version === r2.version,
    'H6 补回之后版本号照旧写进快照（304 语义与内容散列不受影响）', r2 && r2.version)
}

// ---- I 组：跨容器阻塞者按引用态判（#1768）----
// 首帧只拿得到本容器子票，被别的地图里未关闭的票挡住的子票，阻塞者不在本批。
// 口径与 deck 安全侧一致：引用态明确 CLOSED 才放行；OPEN、读不到状态、没有引用态都按挡着。
{
  const crossOpen = carryOverMapTickets(null, snapOf([container('900', 'map', [
    issue('1501', { blockedBy: [{ key: '9001', title: '别图里还开着', state: 'OPEN' }] }),
  ])]), { sourceComplete: true })
  const mOpen = crossOpen.maps[0]
  const rowOpen = ticketByKey(mOpen, '1501')
  check((mOpen.stats || {}).blocked === 1 && (mOpen.stats || {}).frontier === 0,
    'I1 阻塞者在别的地图且开着：这张票算被挡，可接计数不计入', JSON.stringify(mOpen.stats))
  check(!!rowOpen && rowOpen.blockedBy[0] === 9001 && Array.isArray(rowOpen.blockedByRefs) &&
    rowOpen.blockedByRefs[0].key === 9001 && rowOpen.blockedByRefs[0].state === 'OPEN' &&
    rowOpen.blockedByRefs[0].title === '别图里还开着',
    'I2 阻塞者引用态（编号/标题/状态）留在行上，卡片能说出被谁挡着', rowOpen && JSON.stringify(rowOpen.blockedByRefs))
  const crossClosed = carryOverMapTickets(null, snapOf([container('901', 'map', [
    issue('1502', { blockedBy: [{ key: '9002', title: '别图里已关', state: 'CLOSED' }] }),
  ])]), { sourceComplete: true })
  const mClosed = crossClosed.maps[0]
  check((mClosed.stats || {}).blocked === 0 && (mClosed.stats || {}).frontier === 1,
    'I3 阻塞者在别的地图但已关闭：不挡，算可接', JSON.stringify(mClosed.stats))
  const crossUnknown = carryOverMapTickets(null, snapOf([container('902', 'map', [
    issue('1503', { blockedBy: [{ key: '9003', title: '读不到状态' }] }),
  ])]), { sourceComplete: true })
  const mUnknown = crossUnknown.maps[0]
  const rowUnknown = ticketByKey(mUnknown, '1503')
  check((mUnknown.stats || {}).blocked === 1 && (mUnknown.stats || {}).frontier === 0,
    'I4 读不到阻塞者状态时按安全侧算被挡，不算可接', JSON.stringify(mUnknown.stats))
  check(!!rowUnknown && rowUnknown.blockedByRefs[0].state === undefined,
    'I5 没拿到状态就不伪造状态（引用态只留编号与标题）', rowUnknown && JSON.stringify(rowUnknown.blockedByRefs))
  const prevRefs = snapOf([container('903', 'map', [
    issue('1504', { blockedBy: [{ key: '9004', title: '上次就知道开着', state: 'OPEN' }] }),
  ])])
  const nextThin = snapOf([container('903', 'map', [issue('1504', { blockedBy: [] })])])
  const merged = carryOverMapTickets(prevRefs, nextThin, { sourceComplete: false })
  const rowMerged = ticketByKey(merged.maps[0], '1504')
  check((merged.maps[0].stats || {}).blocked === 1 &&
    !!rowMerged && Array.isArray(rowMerged.blockedByRefs) && rowMerged.blockedByRefs[0].state === 'OPEN',
    'I6 不完整来源的薄行没带引用态时，沿用上次已知的引用态（被挡关系不因降级丢失）',
    rowMerged && JSON.stringify({ b: rowMerged.blockedByRefs, s: merged.maps[0].stats }))
  // 两份 groupTickets 副本（宿主 ticketGrouping 与 tracker body-parse）必须同口径：同一夹具逐项全等。
  const fixture = [
    { number: 1, state: 'OPEN', blockedBy: [2], blockedByRefs: [] },
    { number: 2, state: 'OPEN', blockedBy: [], blockedByRefs: [] },
    { number: 3, state: 'OPEN', blockedBy: [9001], blockedByRefs: [{ key: 9001, state: 'OPEN' }] },
    { number: 4, state: 'OPEN', blockedBy: [9002], blockedByRefs: [{ key: 9002, state: 'CLOSED' }] },
    { number: 5, state: 'OPEN', blockedBy: [9003], blockedByRefs: [{ key: 9003 }] },
    { number: 6, state: 'CLOSED', blockedBy: [], blockedByRefs: [] },
    { number: 7, state: 'OPEN', blockedBy: [], blockedByRefs: [] },
    // 认领票同时进 frontier 的错法以前没被抓住（宿主的 isBlocked 把认领也算成一种「挡」），这里补一张。
    { number: 8, state: 'OPEN', claimedBy: 'alice', blockedBy: [], blockedByRefs: [] },
  ]
  const fromHost = createTicketGrouping().groupTickets(fixture)
  const fromParse = bodyParse.groupTickets(fixture)
  const counts = (g: any) => JSON.stringify([g.total, g.open, g.closed, g.frontier, g.claimed, g.blocked])
  check(counts(fromHost) === counts(fromParse),
    'I7 两份 groupTickets 副本对同一夹具给出同样计数（跨容器口径不许只改一处）', counts(fromHost) + ' vs ' + counts(fromParse))
  check(JSON.stringify(fromHost.levelOf) === JSON.stringify(fromParse.levelOf) &&
    JSON.stringify(fromHost.levels) === JSON.stringify(fromParse.levels),
    'I8 两份副本的层级推导也一致（跨容器引用不参与层级深度）')
  check(fromHost.total === 8 && fromHost.open === 7 && fromHost.frontier === 3 && fromHost.claimed === 1 && fromHost.blocked === 3,
    'I9 宿主分组：图内 OPEN、跨图 OPEN、跨图未知各挡一张；跨图 CLOSED 放行；认领票只进 claimed', JSON.stringify(fromHost))
  check(fromHost.levelOf['3'] === 0 && fromHost.levelOf['1'] === 1,
    'I10 跨容器引用不参与层级深度（第 3 张仍算第 0 层）', JSON.stringify(fromHost.levelOf))
}

printGateResult(GATE, total, failed)
process.exit(failed ? 1 : 0)
