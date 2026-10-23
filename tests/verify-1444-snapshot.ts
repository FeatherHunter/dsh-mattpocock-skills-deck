// verify-1444-snapshot.ts —— 门禁：#1444（规格 1439 的 A2 第一批）快照组装经 Tracker 只读会话
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1444-snapshot.ts
//
// 这一条盯的是「快照读路径搬家之后，面板拿到的东西一样不少」：
//   ① 整仓票经 list、每张地图的子票经 listSubIssues、标签经 listLabels、本人经 getCurrentUser，
//      一次 runGh / execProc 都不发，旧路的 fetchIssues 与 REST 降级也一次都不碰；
//   ② 列表行仍是旧 gh 那一套形状（大写状态、assignees 是 login 数组、labels 带颜色），
//      拉取请求照旧不进快照（迁移前 fetchIssues 的 select(.pull_request == null) 同口径）；
//   ③ 地图子票的 blocks 从同一批 items 的 blockedBy 反推（谁被谁挡），不再额外请求；
//      张数、层级、统计、进度、正文五区块与迁移前一致；
//   ④ 选择、仓库身份、viewer、能力计数、backendModules 这些视图字段一个不丢；
//   ⑤ 开会话失败或整仓列表失败时回 { ok:false, error } 旧包（上层照旧降级回缓存），
//      单张地图失败只降级那一张，标签/本人失败退回空值与 null，都不抛、不假装成功。
//
// 假会话照 tests/verify-1444-list-detail-thin.ts 的装配法：直接给工厂一个 openSession 桩，
// 桩里交一份假会话；注册表只给 select/describe/modules 三格，选择三级联那一段由别的门禁盯。
const path = require('path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel: string) => import(require('node:url').pathToFileURL(path.join(ROOT, rel)).href)
const CWD = 'C:/ws/demo'

// 契约票的最小形状：会话交回来的就是这一份（房间已经归一过，state 是小写）。
function issueOf(n: number, over?: any): any {
  return Object.assign({
    key: String(n), effortId: 'e' + n, type: 'issue', title: '票 ' + n, state: 'open', body: '正文',
    url: 'https://github.com/o/r/issues/' + n, createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z', closedAt: null, parentKey: null,
    labels: [{ name: 'ready-for-agent', color: '0e8a16' }], assignees: [{ login: 'me' }],
    author: { login: 'me', name: '我', avatarUrl: 'https://a' }, blockedBy: [],
    isPullRequest: false, mergedAt: null, reviews: [],
  }, over || {})
}

// 假会话：每个方法记账，world 决定回什么（形状照契约的 OpResult）。
function sessionOf(world: any) {
  const calls: any = { list: [], subs: [], labels: [], user: [] }
  const session: any = {
    list: async (ref: any, filter: any, ctx: any) => {
      calls.list.push({ ref: ref, filter: filter, ctx: ctx })
      if (world.listFails) return { ok: false, error: { kind: 'network', message: '列表读取失败', raw: '' } }
      return { ok: true, data: world.issues || [] }
    },
    listSubIssues: async (ref: any, key: any, opts: any, ctx: any) => {
      calls.subs.push({ ref: ref, key: String(key), ctx: ctx })
      if (world.subsFails) return { ok: false, error: { kind: 'unsupported', message: 'markdown listSubIssues unsupported', raw: '' } }
      return { ok: true, data: (world.subs || {})[String(key)] || { items: [], total: 0, fetched: 0, capped: false, missing: [], dropped: [] } }
    },
    listLabels: async (ref: any, ctx: any) => {
      calls.labels.push({ ref: ref, ctx: ctx })
      if (world.labelsFails) return { ok: false, error: { kind: 'network', message: '标签读取失败', raw: '' } }
      return { ok: true, data: world.labels || [] }
    },
    getCurrentUser: async (ref: any, ctx: any) => {
      calls.user.push({ ref: ref, ctx: ctx })
      if (world.userFails) return { ok: false, error: { kind: 'unsupported', message: 'viewer unsupported', raw: '' } }
      return { ok: true, data: world.user || { login: 'me', name: '我', avatarUrl: 'https://a' } }
    },
  }
  return { session: session, calls: calls }
}

// 开会话桩：记下调用与 opts（测 resolveSelection 只传已有结论这一条）；backendId 取会话那边的。
function openerOf(session: any, opened: any[]) {
  return async (cwd: any, opts?: any) => {
    opened.push({ cwd: cwd, opts: opts })
    return { ok: true, backendId: 'github', budget: {}, call: (fn: any) => fn(session, { cwd: cwd, caller: 'refresh' }) }
  }
}

// 依赖装配：旧路口（runGh/execProc/fetchIssues/fetchMapsDetailREST）一律记账并拒绝被调。
function depsOf(build: any, session: any, regOver?: any) {
  const rec: any = { runGh: 0, exec: 0, fetchIssues: 0, rest: 0, opened: [] }
  const registry: any = Object.assign({
    select: async () => ({ backendId: 'github', source: 'matches' }),
    // 第一次 describe 只有 cwd（refId 空），让兜底那一段用 owner/name 补一次，验仓库身份不丢。
    describe: (handle: any, id: string) => ({ backend: id, refId: String((handle && handle.refId) || ''), name: id, url: '' }),
    modules: () => [{ id: 'github' }],
  }, regOver || {})
  const deps: any = {
    getRepoKey: async () => ({ owner: 'o', name: 'r' }),
    runGh: () => { rec.runGh += 1; return { ok: false } },
    execProc: () => { rec.exec += 1; return { ok: false } },
    fetchIssues: () => { rec.fetchIssues += 1; throw new Error('旧路 fetchIssues 不该被调') },
    fetchMapsDetailREST: () => { rec.rest += 1; throw new Error('旧路 REST 降级不该被调') },
    mapTicket: build.mapTicket, parseMapBody: build.parseMapBody,
    computeLevels: build.computeLevels, groupTickets: build.groupTickets,
    isRateLimitError: () => false,
    getTrackerRegistry: async () => registry,
    getPlatform: async () => ({}), getRepoRoot: async () => CWD,
    getGhPath: () => 'gh', getGhLastError: () => null,
    ctx: { get: () => null }, timer: { timeout: () => null },
    openSession: openerOf(session, rec.opened),
  }
  return { deps: deps, rec: rec, registry: registry }
}

async function main() {
  console.log('快照组装经只读会话（#1444）')
  const snapMod = await imp('src/refresh/rooms/host/snapshot-build.js')
  const mb = (await imp('src/host/mapBody.js')).createMapBody()
  const grp = (await imp('src/host/ticketGrouping.js')).createTicketGrouping()
  const build = { mapTicket: mb.mapTicket, parseMapBody: mb.parseMapBody, computeLevels: grp.computeLevels, groupTickets: grp.groupTickets }

  const mapBody = '## Destination\n迁移快照读路径\n\n## Notes\n备注一行'
  const world = {
    issues: [
      issueOf(1, { title: '普通票', updatedAt: '2026-10-01T00:00:00Z' }),
      issueOf(2, { isPullRequest: true, updatedAt: '2026-10-05T00:00:00Z' }),
      issueOf(3, { title: '地图', body: mapBody, updatedAt: '2026-10-03T00:00:00Z', labels: [{ name: 'wayfinder:map', color: '1d76db' }] }),
      issueOf(4, { state: 'closed', title: '已关票', updatedAt: '2026-09-01T00:00:00Z', labels: [{ name: 'bug', color: 'd73a4a' }] }),
    ],
    subs: {
      '3': {
        ok: true, total: 2, fetched: 2, capped: false, missing: [], dropped: [],
        items: [
          issueOf(10, { title: '子票甲', body: '## 进度：60%', labels: [{ name: 'wayfinder:task', color: '0e8a16' }] }),
          issueOf(11, { title: '子票乙', assignees: [{ login: 'other' }], blockedBy: [{ key: '10', title: '子票甲', state: 'open' }] }),
        ],
      },
    },
    labels: [{ name: 'wayfinder:map', color: '1d76db' }, { name: 'bug', color: 'd73a4a' }],
    user: { login: 'me', name: '我', avatarUrl: 'https://a' },
  }

  // ---- ① 成功一趟：一次会话取齐，形状与迁移前同 ----
  {
    const s = sessionOf(world)
    const d = depsOf(build, s.session)
    const snap = await snapMod.createSnapshotBuilder(d.deps).buildSnapshot(CWD)
    check(snap && snap.ok === true, '快照回 ok:true（' + (snap && snap.ok) + '）')
    const rows = snap.issues || []
    check(rows.length === 3 && rows[0].number === 3 && rows[1].number === 1 && rows[2].number === 4, '列表按 updatedAt 倒序、拉取请求不进快照（' + rows.map((x: any) => x.number).join('、') + '）')
    check(rows[1].state === 'OPEN' && rows[2].state === 'CLOSED', '状态仍是大写 OPEN/CLOSED')
    check(rows[1].assignees.length === 1 && rows[1].assignees[0] === 'me' && rows[1].author.name === '我', '列表行 assignees 是 login 数组、author 带名字（旧 gh 形状）')
    check(rows[1].labels[0].name === 'ready-for-agent' && rows[1].labels[0].color === '0e8a16' && rows[1].createdAt === '2026-09-01T00:00:00Z', 'labels 仍有 {name,color}，createdAt 原样带出')
    check(typeof rows[1].isPullRequest === 'undefined', '列表行不带新旧契约的 isPullRequest（旧行没有这一格）')

    const maps = snap.maps || []
    check(maps.length === 1 && maps[0].number === 3 && maps[0].state === 'OPEN', '只把带 wayfinder:map 的开启票当地图（' + maps.length + ' 张）')
    check(maps[0].labels[0] === 'wayfinder:map' && maps[0].destination === '迁移快照读路径' && maps[0].notes === '备注一行', '地图行仍有 labels/destination/notes（正文五区块照旧解析）')
    check(maps[0].url === 'https://github.com/o/r/issues/3', '地图行 url 照旧')

    const tickets = maps[0].tickets || []
    check(tickets.length === 2 && tickets[0].number === 10 && tickets[1].number === 11, '地图子票张数与迁移前一致（2 张：' + tickets.map((t: any) => t.number).join('、') + '）')
    check(tickets[0].blocks.length === 1 && tickets[0].blocks[0] === 11 && tickets[1].blocks.length === 0, 'blocks 从 items 的 blockedBy 反推（10 挡着 11）')
    check(tickets[1].blockedBy.length === 1 && tickets[1].blockedBy[0] === 10 && tickets[1].claimedBy === 'other', 'blockedBy 与认领人仍是数字与 login 字符串')
    check(tickets[0].level === 0 && tickets[1].level === 1 && tickets[0].labels[0] === 'wayfinder:task', '层级照旧挂在票上，labels 仍是名字数组')
    check(tickets[0].progress === 60 && tickets[1].progress === null, '子票进度仍从正文读（60 与未表达 null）')
    const stats = maps[0].stats || {}
    check(stats.total === 2 && stats.open === 2 && stats.claimed === 2 && stats.levelOf[11] === 1 && stats.levels.length === 2, '统计与分层整包照旧（total/claimed/levelOf/levels）')

    check(snap.selection && snap.selection.backendId === 'github' && snap.selection.source === 'matches', '选择结论原样进快照')
    check(snap.repository && snap.repository.refId === 'o/r' && snap.repository.backend === 'github', '仓库身份仍由 describe 产出并补全 owner/name（' + (snap.repository && snap.repository.refId) + '）')
    check(Array.isArray(snap.backendModules) && snap.backendModules[0].id === 'github', 'backendModules 仍是投影之后的后端描述')
    const cap = snap.capabilities || {}
    check(cap.present === 9 && cap.empty === 0 && cap.missing === 18, '能力计数按三段口径照旧（' + cap.present + '/' + cap.empty + '/' + cap.missing + '）')
    check(snap.viewerLogin === 'me' && snap.viewer && snap.viewer.name === '我', 'viewer 仍来自后端 getCurrentUser（"本人不显"对比用）')
    check(snap.fallback === null && snap.fallbackAt === null, 'REST 降级标记仍在信封上（旧路已删，恒 null）')
    check(typeof snap.generatedMs === 'number' && typeof snap.repoRoot === 'string' && snap.env && snap.env.ghPath === 'gh', '信封的时间、仓库根、gh 诊断格照旧')

    check(d.rec.runGh === 0 && d.rec.exec === 0 && d.rec.fetchIssues === 0 && d.rec.rest === 0, '零 runGh / 零 execProc / 不碰旧 fetchIssues 与 REST 降级')
    check(s.calls.list.length === 1 && s.calls.list[0].filter === undefined && s.calls.list[0].ctx.caller === 'refresh', '整仓票一次 list，不带筛选（state:all 在契约里是非法筛选）')
    check(s.calls.subs.length === 1 && s.calls.subs[0].key === '3', '地图子票逐张 listSubIssues（只问这一张）')
    check(s.calls.labels.length === 1 && s.calls.user.length === 1, '标签与本人各取一次')
    check(d.rec.opened.length === 1 && d.rec.opened[0].cwd === CWD && typeof d.rec.opened[0].opts.resolveSelection === 'function', '开会话一次，且把已有选择结论作为 resolveSelection 传下去')
    const reused = await d.rec.opened[0].opts.resolveSelection({ cwd: CWD }, {})
    check(reused && reused.backendId === 'github', 'resolveSelection 回的正是快照这一份选择（会话不二次探测）')
  }

  // ---- ② 失败面：开会话/整仓列表如实失败，单图/标签/本人各自降级 ----
  {
    const s = sessionOf(world)
    const d = depsOf(build, s.session)
    d.deps.openSession = async () => ({ ok: false, reason: 'no-backend' })
    const snap = await snapMod.createSnapshotBuilder(d.deps).buildSnapshot(CWD)
    check(snap && snap.ok === false && snap.error.kind === 'env' && /no-backend/.test(snap.error.error), '开会话失败回 {ok:false,error} 旧包（不抛）：' + (snap && snap.error && snap.error.error))
  }
  {
    const s = sessionOf({ issues: world.issues, listFails: true })
    const d = depsOf(build, s.session)
    const snap = await snapMod.createSnapshotBuilder(d.deps).buildSnapshot(CWD)
    check(snap && snap.ok === false && snap.error.kind === 'network' && snap.error.error === '列表读取失败', '整仓列表失败回 {ok:false,error:network}（上层降级回缓存）')
  }
  {
    const s = sessionOf({ issues: world.issues, subsFails: true, labels: world.labels })
    const d = depsOf(build, s.session)
    const snap = await snapMod.createSnapshotBuilder(d.deps).buildSnapshot(CWD)
    check(snap && snap.ok === true && snap.maps.length === 1 && snap.maps[0].tickets.length === 0 && snap.maps[0].stats.total === 0, '单张地图取子票失败只降级那一张（票与标签照旧）')
    check(snap.maps[0].error && snap.maps[0].error.kind === 'unsupported' && snap.maps[0].error.error === 'markdown listSubIssues unsupported', '降级的那张带旧包的 {kind,error}（新错误结构不冒到界面）')
    check(snap.issues.length === 3 && snap.labels.length === 2, '其它两段不受影响（整仓票 3、标签 2）')
  }
  {
    const s = sessionOf({ issues: [issueOf(1, { labels: [{ name: 'wayfinder:map', color: '1d76db' }] })], labelsFails: true, userFails: true })
    const d = depsOf(build, s.session)
    const snap = await snapMod.createSnapshotBuilder(d.deps).buildSnapshot(CWD)
    check(snap && snap.ok === true && snap.labels.length === 0 && snap.viewer === null && snap.viewerLogin === null, '标签与本人取不到时退回 [] 与 null（不阻塞快照）')
  }
  {
    const s = sessionOf(world)
    const d = depsOf(build, s.session, { select: async () => ({ backendId: null, source: 'explicit' }) })
    const snap = await snapMod.createSnapshotBuilder(d.deps).buildSnapshot(CWD)
    check(snap && snap.ok === true && snap.maps.length === 0 && snap.issues.length === 0 && snap.labels.length === 0, '显式空选择回空集合信封（不假装有数据）')
    check(snap.selection && snap.selection.backendId === null && snap.selection.source === 'explicit' && snap.capabilities === null, '空信封仍带选择结论，能力计数如实为 null')
    check(d.rec.opened.length === 0 && d.rec.runGh === 0, '没有选择就不开会话、不发请求')
  }
  {
    const s = sessionOf(world)
    const d = depsOf(build, s.session)
    d.deps.openSession = undefined
    const snap = await snapMod.createSnapshotBuilder(d.deps).buildSnapshot(CWD)
    check(snap && snap.ok === false && snap.error.kind === 'env' && /open-session/.test(snap.error.error), '没注入会话口时如实失败（不退回 gh）')
  }
  {
    const s = sessionOf(world)
    const d = depsOf(build, s.session)
    d.deps.getTrackerRegistry = async () => { throw new Error('注册表没就绪') }
    const snap = await snapMod.createSnapshotBuilder(d.deps).buildSnapshot(CWD)
    check(snap && snap.ok === true && snap.selection === null && snap.maps.length === 0, '注册表取不到时回空信封（迁移前同口径：不炸）')
  }

  // ---- ③ 静态：零直调 gh、零 gate.send、aliases 查询与 REST 降级已删 ----
  {
    const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l: string) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l }).join('\n')
    const src = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'refresh', 'rooms', 'host', 'snapshot-build.ts'), 'utf8'))
    check(src.indexOf('runGh(') < 0, 'snapshot-build.ts 里没有 runGh( 直调')
    check(src.indexOf('gate.send') < 0, 'snapshot-build.ts 里没有 gate.send')
    check(src.indexOf("'graphql'") < 0 && src.indexOf('m0:issue') < 0 && src.indexOf('fetchMapsDetailREST(') < 0, 'GraphQL aliases 多图查询与 REST 降级调用已删')
    const built = snapMod.createSnapshotBuilder(depsOf(build, sessionOf(world).session).deps)
    check(typeof built.fetchMapsDetail === 'undefined', '多图详情那个旧出口已从回包删除')
  }

  console.log('\n' + (failed ? '存在失败 — #1444 快照读路径门禁未通过' : '全部通过 — 快照读路径只走只读会话（' + total + ' 条断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e: any) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
