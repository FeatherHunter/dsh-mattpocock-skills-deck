// tests/verify-1548-map-row-nav.ts —— 门禁：#1548 本地后端在办表里地图行显示完整、点击进容器详情。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1548-map-row-nav.ts
//
// 背景：本地 Markdown 后端的工作路线弹窗里，地图容器行（编号 00）首列只给了 40px，
// 「#目录名/00」被挤成纵向半截字；点击时快照容器表里没有这张地图的身份（无 key/effortId/type），
// findMapByIdentity 找不到、containerKindOf 认不出，只能回落普通票详情（n=0 那一格）。
// 规格 00 行更进一步：连容器表都进不去（旧判据只认 wayfinder:map 标签）。
// 本门禁锁住修完之后的样子：
//   1) 快照容器表收两类容器：type map 与 type spec（与客户端 containerKindOf 同一条口径），
//      每一行都带 key/effortId/type（客户端按 (effortId, key) 找容器、按 type 认种类）；
//      普通票（type issue）不进容器表。
//   2) 客户端按新身份找得到地图 00 与规格 00（进容器详情），普通票 01 找不到（回落票详情）；
//      老快照（只有 number 0、没有身份字段）仍按数字兜底找得到，不因升级而断链。
//   3) 首列自适应（#1553）：按本表实际行的编号长度分档（56/96/136/192px），短编号收窄、长编号放宽，目录名不缩写；
//      （#1548 注释里“最长 17 个字符”写错了：仓里 .scratch 目录名最长 32 个字符，定宽 128px 本来也放不下。）
//      普通「#1548」这类短编号收进 56px 那一档。
//
// 手法：快照段走 verify-1444 同一套假会话（只换 Markdown 形状的行）；
// 客户端段直接导真模块（store-derived、container-view、workRouteTable 三个都没有 import，无副作用）。
// 纯内存、无落盘、可并发。
//
// 门禁归属: src/refresh/rooms/host/snapshot-build.ts
// 门禁归属: src/client/kernel/store-derived.ts
// 门禁归属: src/client/views/shared/workRouteTable.ts
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel: string) => import(require('node:url').pathToFileURL(path.join(ROOT, rel)).href)
const CWD = 'C:/ws/demo'

// 契约票的最小形状（照 verify-1444 的 issueOf，key/effortId/type 三格是核心字段，永远存在）。
function issueOf(key: string, effortId: string, type: string, over?: any): any {
  return Object.assign({
    key: key, effortId: effortId, type: type, title: '票 ' + effortId + '/' + key, state: 'open', body: '正文',
    url: 'https://local/' + effortId + '/' + key, createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-10-26T00:00:00Z', closedAt: null, parentKey: null,
    labels: [{ name: 'ready-for-agent', color: '0e8a16' }], assignees: [{ login: 'me' }],
    author: { login: 'me', name: '我', avatarUrl: 'https://a' }, blockedBy: [],
    isPullRequest: false, mergedAt: null, reviews: [],
  }, over || {})
}

function sessionOf(world: any) {
  const session: any = {
    list: async () => ({ ok: true, data: world.issues || [] }),
    listSubIssues: async (_ref: any, key: any) => ({ ok: true, data: (world.subs || {})[String(key)] || { items: [], total: 0, fetched: 0, capped: false, missing: [], dropped: [] } }),
    listLabels: async () => ({ ok: true, data: world.labels || [] }),
    getCurrentUser: async () => ({ ok: true, data: world.user || { login: 'me', name: '我', avatarUrl: 'https://a' } }),
  }
  return { session: session }
}

function openerOf(session: any) {
  return async (cwd: any, opts?: any) => {
    return { ok: true, backendId: 'markdown', budget: {}, call: (fn: any) => fn(session, { cwd: cwd, caller: 'refresh' }) }
  }
}

function depsOf(build: any, session: any) {
  const registry: any = {
    select: async () => ({ backendId: 'markdown', source: 'matches' }),
    describe: (handle: any, id: string) => ({ backend: id, refId: String((handle && handle.refId) || ''), name: id, url: '' }),
    modules: () => [{ id: 'markdown' }],
  }
  return {
    getRepoKey: async () => ({ owner: 'o', name: 'r' }),
    runGh: () => { throw new Error('旧路 runGh 不该被调') },
    execProc: () => { throw new Error('旧路 execProc 不该被调') },
    fetchIssues: () => { throw new Error('旧路 fetchIssues 不该被调') },
    fetchMapsDetailREST: () => { throw new Error('旧路 REST 降级不该被调') },
    mapTicket: build.mapTicket, parseMapBody: build.parseMapBody,
    computeLevels: build.computeLevels, groupTickets: build.groupTickets,
    isRateLimitError: () => false,
    getTrackerRegistry: async () => registry,
    getPlatform: async () => ({}), getRepoRoot: async () => CWD,
    getGhPath: () => 'gh', getGhLastError: () => null,
    ctx: { get: () => null }, timer: { timeout: () => null },
    openSession: openerOf(session),
  }
}

async function main() {
  console.log('#1548 在办表地图行：显示完整、点击进容器详情、规格同修、普通行零回归')
  const snapMod = await imp('src/refresh/rooms/host/snapshot-build.js')
  const mb = (await imp('src/host/mapBody.js')).createMapBody()
  const grp = (await imp('src/host/ticketGrouping.js')).createTicketGrouping()
  const build = { mapTicket: mb.mapTicket, parseMapBody: mb.parseMapBody, computeLevels: grp.computeLevels, groupTickets: grp.groupTickets }

  const mapBody = '## Destination\n地图正文\n\n## Notes\n备注一行'
  const world = {
    issues: [
      issueOf('00', 'demo', 'map', { title: '地图', body: mapBody, updatedAt: '2026-10-26T00:00:03Z' }),
      issueOf('00', 'demo2', 'spec', { title: '规格', body: '## 目的\n规格正文', updatedAt: '2026-10-26T00:00:02Z' }),
      issueOf('01', 'demo', 'issue', { title: '普通票', updatedAt: '2026-10-26T00:00:01Z' }),
    ],
    subs: {
      '0': {
        ok: true, total: 1, fetched: 1, capped: false, missing: [], dropped: [],
        items: [issueOf('10', 'demo', 'issue', { title: '子票甲', body: '## 进度：60%' })],
      },
    },
    labels: [{ name: 'ready-for-agent', color: '0e8a16' }],
    user: { login: 'me', name: '我', avatarUrl: 'https://a' },
  }

  // ---- ① 快照容器表：地图与规格都在，身份三格齐全，普通票不进表 ----
  const s = sessionOf(world)
  const snap = await snapMod.createSnapshotBuilder(depsOf(build, s.session)).buildSnapshot(CWD)
  check(snap && snap.ok === true, '快照回 ok:true（' + (snap && snap.ok) + '）')
  const maps = snap.maps || []
  check(maps.length === 2, '容器表有地图与规格两行、普通票不进表（' + maps.length + ' 行）')
  const mapRow = maps.find(function (m: any) { return m && m.effortId === 'demo' })
  const specRow = maps.find(function (m: any) { return m && m.effortId === 'demo2' })
  check(!!mapRow && mapRow.number === 0 && mapRow.key === '00' && mapRow.effortId === 'demo' && mapRow.type === 'map',
    '地图行带齐身份（number 0、key 00、effortId demo、type map）')
  check(!!specRow && specRow.number === 0 && specRow.key === '00' && specRow.effortId === 'demo2' && specRow.type === 'spec',
    '规格行同样进表且带齐身份（Q3：规格 00 同修）')
  check(!maps.some(function (m: any) { return m && m.key === '01' }), '普通票 01 不进容器表')
  check(mapRow && mapRow.destination === '地图正文' && Array.isArray(mapRow.tickets) && mapRow.tickets.length === 1,
    '地图行正文与子票照旧解析（destination 与 1 张子票）')

  // ---- ② 客户端查找：新身份命中容器、普通行回落、老快照数字兜底 ----
  const storeDerived = await imp('src/client/kernel/store-derived.js')
  // store-derived.ts 里身份三函数是打包闭包给的全局（declare），单测里把真身挂上（与 verify-1545 挂 ticketLabelOf 同一做法）。
  const identityKeys = await imp('src/tracker/kernel/identity-keys.js')
  ;(globalThis as any).idOfParts = identityKeys.idOfParts
  ;(globalThis as any).idOf = identityKeys.idOf
  ;(globalThis as any).effortOf = identityKeys.effortOf
  const containerView = await imp('src/client/kernel/container-view.js')
  const findMapByIdentity = storeDerived.findMapByIdentity
  const containerKindOf = containerView.containerKindOf
  check(typeof findMapByIdentity === 'function' && typeof containerKindOf === 'function', '真模块导出 findMapByIdentity 与 containerKindOf')
  const hitMap = findMapByIdentity(maps, '00', 'demo')
  check(!!hitMap && containerKindOf(hitMap) === 'map', '地图 00 按 (demo, 00) 找得到且认得出是 map（进容器详情）')
  const hitSpec = findMapByIdentity(maps, '00', 'demo2')
  check(!!hitSpec && containerKindOf(hitSpec) === 'spec', '规格 00 按 (demo2, 00) 找得到且认得出是 spec（进容器详情）')
  check(findMapByIdentity(maps, '01', 'demo') === null, '普通票 01 在容器表里找不到（回落票详情，零回归）')
  check(findMapByIdentity(maps, '00', 'other') === null, '目录不对时找不到（不串到别人家的地图）')
  const legacy = [{ number: 0, title: '老地图', labels: ['wayfinder:map'], tickets: [], stats: {} }]
  check(!!findMapByIdentity(legacy, '00', 'demo'), '老快照（只有 number 0、无身份字段）仍按数字兜底找得到')

  // ---- ③ 首列宽度自适应（#1553）与编号写法 ----
  const workRouteTable = await imp('src/client/views/shared/workRouteTable.js')
  const cellsFor = (await imp('src/client/kernel/ticket-label.js')).workRouteCellsFor
  const ticketLabel = (await imp('src/client/kernel/ticket-label.js')).ticketLabelOf
  const label = ticketLabel('00', 'demo')
  check(label === '#demo/00', '容器票号写成「#目录名/编号」整串（点行之前先看得见）：' + label)
  check(cellsFor([{ ticketKey: '101' }]).split(' ')[0] === '56px', '短编号收窄到 56px（#1548 那种）')
  check(cellsFor([{ ticketKey: '00', effortId: 'demo' }]).split(' ')[0] === '96px', '「#demo/00」放宽到 96px，目录不缩写')
  check(cellsFor([{ ticketKey: '00', effortId: 'undefined-wf1089-bodies-20261021' }]).split(' ')[0] === '192px', '32 字超长目录封顶 192px（再长走省略号+悬停）')
  check(cellsFor([{ ticketKey: '00', effortId: '测试' }]).split(' ')[0] === '96px', '中文目录按宽字符估（#测试/00 → 96px）')
  check(cellsFor([{ ticketKey: '00', effortId: 'demo' }, { ticketKey: '1548' }]).split(' ')[0] === '96px', '混排时按最长的那一行定（全表共用一份）')
  check(String(workRouteTable.WORK_ROUTE_TABLE_CELLS).split(' ')[0] === '56px', '默认模板即短档 56px')

  console.log('\n' + (failed ? '存在失败 — #1548 门禁未通过' : '全部通过 — 地图行显示与跳转（' + total + ' 条断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e: any) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
