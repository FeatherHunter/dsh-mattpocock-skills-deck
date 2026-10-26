// verify-1444-list-detail-thin.ts —— 门禁：#1444（规格 1439 的 A2 第一批）四条读路径经 Tracker 只读会话
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1444-list-detail-thin.ts
//
// 这一条盯的是「读路径搬家之后行为没有漂」：
//   ① 列表、地图、索引、详情、薄行都只调会话能力（list / listPage / get / getDependencies），
//      一次 runGh 都不发；本文件也不再出现 gate.send；
//   ② 回包形状与迁移前一致（列表行、地图行、详情 GraphQL 形状、薄行行），上层三处消费方不用改；
//   ③ 失败时回 { ok:false }（开会话失败、能力失败、缺 listPage 都如实报），不抛、不假装成功；
//   ④ 索引翻页按 PageResult.nextCursor 取全量，窗口起点生效；水印仍然只在显式 commit 时前进。
//      单页条数跟随契约（#1418 的连接上限打底、2026-10-26 的三秒掐线再压一档：页大小取契约的 listPageSize）。
//
// 假世界照 tests/verify-1442-tracker-tools.ts 的装配法：直接给工厂一个 openSession 桩，
// 桩里交一份假会话；不经过注册表（那一段由 verify-1442 自己盯），这样每条路只测自己的接线。
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
    key: String(n), effortId: 'e', type: 'issue', title: '票 ' + n, state: 'open', body: '正文',
    url: 'https://github.com/o/r/issues/' + n, createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z', closedAt: null, parentKey: null,
    labels: [{ name: 'wayfinder:map', color: '1d76db' }], assignees: [{ login: 'me' }],
    author: { login: 'me', name: '我', avatarUrl: 'https://a' }, blockedBy: [],
    isPullRequest: false, mergedAt: null, reviews: [],
  }, over || {})
}

// 假会话：每个方法都记账，测试只读这本账；world 决定每次回什么。
function sessionOf(world: any) {
  const calls: any = { list: [], listPage: [], get: [], deps: [], subs: [] }
  const session: any = {
    list: async (ref: any, filter: any, ctx: any) => {
      calls.list.push({ ref: ref, filter: filter, ctx: ctx })
      if (world.listFails) return { ok: false, error: { kind: 'network', message: '列表读取失败', raw: '' } }
      return { ok: true, data: world.issues || [] }
    },
    listPage: async (ref: any, filter: any, opts: any, ctx: any) => {
      calls.listPage.push({ ref: ref, filter: filter, opts: opts, ctx: ctx })
      if (world.listPageFails) return { ok: false, error: { kind: 'network', message: '索引读取失败', raw: '' } }
      const key = opts && opts.cursor ? String(opts.cursor) : ''
      const page = (world.pages || {})[key]
      return page || { ok: true, data: { items: [], nextCursor: null, total: 0 } }
    },
    get: async (ref: any, key: any, opts: any, ctx: any) => {
      calls.get.push({ ref: ref, key: String(key), opts: opts, ctx: ctx })
      const hit = (world.gets || {})[String(key)]
      if (hit) return hit
      return { ok: false, error: { kind: 'notFound', message: '找不到 #' + key, raw: '' } }
    },
    getDependencies: async (ref: any, key: any, opts: any, ctx: any) => {
      calls.deps.push({ ref: ref, key: String(key) })
      if (world.depsFails) return { ok: false, error: { kind: 'network', message: '阻塞边读取失败', raw: '' } }
      return { ok: true, data: { blockedBy: [{ key: '1', title: '阻塞票', state: 'open' }], blocking: [] } }
    },
    listSubIssues: async (ref: any, key: any, opts: any, ctx: any) => {
      calls.subs.push({ key: String(key) })
      return { ok: true, data: { items: [], total: 0, fetched: 0, capped: false, missing: [], dropped: [] } }
    },
  }
  return { session: session, calls: calls }
}
function openerOf(session: any, backendId?: string) {
  return async () => ({ ok: true, backendId: backendId || 'markdown', budget: {}, call: (fn: any) => fn(session, { cwd: CWD, caller: 'refresh' }) })
}

async function main() {
  console.log('刷新后台四条读路径经只读会话（#1444）')
  const listMod = await imp('src/refresh/rooms/host/issue-list-fetch.js')
  const detailMod = await imp('src/refresh/rooms/host/issue-detail-fetch.js')
  const thinMod = await imp('src/refresh/rooms/host/thin-row-fetch.js')
  const win = await imp('src/refresh/kernel/index-window-rules.js')
  const contract = await imp('src/tracker/contract/pagination.js')

  // ---- ① 列表与地图：会话 list，形状照旧，一次 gh 都不发 ----
  {
    const pr = issueOf(2, { isPullRequest: true, mergedAt: null, updatedAt: '2026-10-03T00:00:00Z' })
    const map = issueOf(3, { title: '地图', updatedAt: '2026-10-02T00:00:00Z' })
    const one = issueOf(1)
    const world = { issues: [one, pr, map] }
    const s = sessionOf(world)
    let runGhCalls = 0
    const list = listMod.createIssueList({
      getRepoKey: async () => ({ owner: 'o', name: 'r' }),
      runGh: () => { runGhCalls += 1; return { ok: false } },
      setCache: () => {}, issueIndexFromSnapshot: (snap: any) => win.indexFromSnapshot(snap),
      issueIndexChanged: () => false, rememberIssueIndex: () => {}, readDiskCache: async () => null,
      logCtx: null, openSession: openerOf(s.session),
    })
    const got = await list.fetchIssues(CWD)
    check(got && got.ok === true && got.issues.length === 2, '列表回包仍是 {ok:true, issues:[…]}（' + (got && got.ok) + '）')
    check(got.issues[0].number === 3 && got.issues[1].number === 1, '列表仍按 updatedAt 倒序（' + got.issues.map((x: any) => x.number).join('、') + '）')
    check(got.issues.every((x: any) => x.isPullRequest !== true), '拉取请求不进快照（旧 REST 的 select(.pull_request == null) 同样滤掉；否则索引与 listPage 对不上）')
    const listRow = got.issues[0]
    check(Array.isArray(listRow.assignees) && listRow.assignees[0] === 'me' && listRow.labels[0].name === 'wayfinder:map', '列表行的 assignees 是 login 字符串、labels 是 {name,color}（旧 gh 形状）')
    check(listRow.state === 'OPEN' && listRow.updatedAt === '2026-10-02T00:00:00Z', '状态仍是大写 OPEN/CLOSED，updatedAt 原样带出')
    check(s.calls.list.length === 1 && s.calls.list[0].filter === undefined, 'fetchIssues 调 list(repo, undefined)，不自己加筛选')
    check(runGhCalls === 0, '列表路径零 runGh（实发 ' + runGhCalls + ' 次）')

    const maps = await list.fetchMaps(CWD)
    check(maps && maps.ok === true && maps.maps.length >= 1 && maps.maps[0].number === 1, '地图回包仍是 {ok:true, maps:[…]}（第一张是 1）')
    const mf = s.calls.list[1].filter
    check(mf && Array.isArray(mf.labels) && mf.labels[0] === 'wayfinder:map' && mf.state === 'open', '地图只问 wayfinder:map + open（' + JSON.stringify(mf) + '）')
    const mrow = maps.maps[0]
    check(mrow.state === 'OPEN' && mrow.labels[0].name === 'wayfinder:map' && mrow.assignees[0].login === 'me' && mrow.body === '正文', '地图行仍是 gh issue list 那一套字段（state/labels/assignees/body）')
    check(runGhCalls === 0, '地图路径同样零 runGh')

    const bad = listMod.createIssueList({ getRepoKey: async () => ({ owner: 'o', name: 'r' }), setCache: () => {}, issueIndexFromSnapshot: () => null, issueIndexChanged: () => false, rememberIssueIndex: () => {}, readDiskCache: async () => null })
    const noSess = await bad.fetchIssues(CWD)
    check(noSess && noSess.ok === false && noSess.error && noSess.error.kind === 'env', '没注入会话时列表回 {ok:false,error}（不抛）')
  }

  // ---- ② 索引：listPage 按游标翻到底，窗口滤波生效，缺 listPage 如实失败 ----
  {
    const nowIso = new Date(Date.now() - 60000).toISOString()
    const oldIso = '2026-01-01T00:00:00Z'
    const pages = {
      '': { ok: true, data: { items: [issueOf(1, { updatedAt: nowIso }), issueOf(2, { updatedAt: oldIso })], nextCursor: 'c1', total: 3 } },
      'c1': { ok: true, data: { items: [issueOf(3, { state: 'closed', updatedAt: nowIso })], nextCursor: null, total: 3 } },
    }
    const s = sessionOf({ pages: pages })
    const list = listMod.createIssueList({
      getRepoKey: async () => ({ owner: 'o', name: 'r' }), setCache: () => {},
      issueIndexFromSnapshot: (snap: any) => win.indexFromSnapshot(snap), issueIndexChanged: () => false,
      rememberIssueIndex: () => {}, readDiskCache: async () => null, openSession: openerOf(s.session),
    })
    const idx = await list.fetchIssueIndex(CWD, new Date(Date.now() - 3600000).toISOString())
    check(idx && idx.ok === true && idx.count === 2, '索引只收窗口内的票（旧日期那张被过滤，count=' + (idx && idx.count) + '）')
    check(idx.index['1'] === 'OPEN|' + nowIso && idx.index['3'] === 'CLOSED|' + nowIso, '索引值仍是 状态|更新时间')
    const wantLimit = contract.PAGINATION.github.listPageSize
    check(s.calls.listPage.length === 2 && s.calls.listPage[0].opts.limit === wantLimit && s.calls.listPage[1].opts.cursor === 'c1', '按 PageResult.nextCursor 翻到底（两页、游标透传，单页条数跟随契约 ' + wantLimit + ' 条）')
    check(s.calls.listPage[0].ctx && s.calls.listPage[0].ctx.caller === 'refresh', '索引调用也带 caller=refresh')

    const unsupported = { list: async () => ({ ok: true, data: [] }), get: async () => ({ ok: false }) }
    const list2 = listMod.createIssueList({
      getRepoKey: async () => ({ owner: 'o', name: 'r' }), setCache: () => {},
      issueIndexFromSnapshot: () => null, issueIndexChanged: () => false, rememberIssueIndex: () => {},
      readDiskCache: async () => null, openSession: openerOf(unsupported),
    })
    const un = await list2.fetchIssueIndex(CWD, '')
    check(un && un.ok === false && un.error.kind === 'unsupported', '会话没有 listPage 时如实回 unsupported（不退回 gh）')

    const list3 = listMod.createIssueList({
      getRepoKey: async () => ({ owner: 'o', name: 'r' }), setCache: () => {},
      issueIndexFromSnapshot: () => null, issueIndexChanged: () => false, rememberIssueIndex: () => {},
      readDiskCache: async () => null, openSession: openerOf(sessionOf({ listPageFails: true }).session),
    })
    const failedIdx = await list3.fetchIssueIndex(CWD, '')
    check(failedIdx && failedIdx.ok === false && failedIdx.error.kind === 'network', '索引能力失败时回 {ok:false,error}（kind 原样）')
  }

  // ---- ③ 详情：get + getDependencies，GraphQL 形状不变，失败如实 ----
  {
    const issue7 = issueOf(7, { comments: [{ author: { login: 'c1' }, authorAssociation: 'MEMBER', body: '评论', createdAt: '2026-09-02T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z' }] })
    const pr8 = issueOf(8, { isPullRequest: true, state: 'closed', mergedAt: '2026-09-03T00:00:00Z', reviews: [{ state: 'APPROVED', reviewer: { login: 'rv' }, submittedAt: '2026-09-03T00:00:00Z' }] })
    const world = { gets: { '7': { ok: true, data: issue7 }, '8': { ok: true, data: pr8 } } }
    const s = sessionOf(world)
    let runGhCalls = 0
    const detail = detailMod.createIssueDetail({
      getRepoKey: async () => ({ owner: 'o', name: 'r' }),
      runGh: () => { runGhCalls += 1; return { ok: false } },
      openSession: openerOf(s.session),
    })
    const d7 = await detail.fetchIssueDetail(7, CWD)
    check(d7 && d7.ok === true && d7.issue.number === 7 && d7.issue.state === 'OPEN', '详情回 {ok:true, issue}，状态仍大写')
    check(Array.isArray(d7.issue.labels.nodes) && d7.issue.labels.nodes[0].name === 'wayfinder:map' && d7.issue.assignees.nodes[0].login === 'me', 'labels/assignees 仍是 {nodes} 连接')
    check(d7.issue.comments.nodes.length === 1 && d7.issue.comments.pageInfo.hasNextPage === false, '评论仍是 {nodes, pageInfo}')
    check(d7.issue.blockedBy.nodes[0].number === 1 && d7.issue.blockedBy.nodes[0].state === 'OPEN' && Array.isArray(d7.issue.blocking.nodes), '阻塞边仍是 {nodes:[{number,title,state}]}')
    check(d7.issue.subIssues && d7.issue.subIssues.totalCount === 0 && Array.isArray(d7.issue.subIssues.nodes), 'subIssues 给空连接（子票清单仍由快照/地图那条路提供）')
    check(s.calls.get[0].opts && s.calls.get[0].opts.comments.first === 50 && s.calls.get[0].ctx.caller === 'refresh', 'get 只带一页 50 条评论与 caller=refresh')
    check(s.calls.deps.length === 1, '阻塞边单独问一次 getDependencies')
    check(runGhCalls === 0, '详情路径零 runGh（实发 ' + runGhCalls + ' 次）')
    const d8 = await detail.fetchIssueDetail(8, CWD, { isPullRequest: true })
    check(d8 && d8.ok === true && d8.issue.isPullRequest === true && d8.issue.mergedAt === '2026-09-03T00:00:00Z' && d8.issue.reviews[0].author.login === 'rv', '拉取请求字段照旧（isPullRequest/mergedAt/reviews.author）')
    const dMiss = await detail.fetchIssueDetail(99, CWD)
    check(dMiss && dMiss.ok === false && dMiss.error.kind === 'notFound', '单票未命中时回 {ok:false, kind:notFound}')

    // 阻塞边那一问失败：详情不能崩，入边退回 get 自带的那一份。
    const withBlocked = issueOf(10, { blockedBy: [{ key: '1', title: '自带入边', state: 'open' }] })
    const s2 = sessionOf({ gets: { '10': { ok: true, data: withBlocked } }, depsFails: true })
    const detail2 = detailMod.createIssueDetail({ getRepoKey: async () => ({ owner: 'o', name: 'r' }), openSession: openerOf(s2.session) })
    const d10 = await detail2.fetchIssueDetail(10, CWD)
    check(d10 && d10.ok === true && d10.issue.blockedBy.nodes[0].number === 1 && d10.issue.blocking.nodes.length === 0, 'getDependencies 失败只退化阻塞边，详情照常显示')

    const openFail = detailMod.createIssueDetail({ getRepoKey: async () => ({ owner: 'o', name: 'r' }), openSession: async () => ({ ok: false, reason: 'no-backend' }) })
    const dOpen = await openFail.fetchIssueDetail(7, CWD)
    check(dOpen && dOpen.ok === false && dOpen.error.kind === 'env' && /no-backend/.test(dOpen.error.message), '开会话失败回 {ok:false, error:env}（上层照旧降级回缓存）')
  }

  // ---- ④ 薄行：一趟会话逐票 get，一条失败整批不并 ----
  {
    const world = { gets: { '7': { ok: true, data: issueOf(7) }, '8': { ok: true, data: issueOf(8, { isPullRequest: true, updatedAt: '2026-10-05T00:00:00Z' }) } } }
    const s = sessionOf(world)
    const stats = { thinQueries: 0 }
    const got = await thinMod.fetchThinRows({ openSession: openerOf(s.session), stats: stats }, CWD, { owner: 'o', name: 'r' }, ['7', '8'])
    check(got && got.ok === true && got.rows.length === 2 && got.queries === 2 && stats.thinQueries === 2, '薄行一次取两条、计数进 stats（' + stats.thinQueries + '）')
    check(got.rows[0].number === 7 && got.rows[0].assignees[0] === 'me' && got.rows[1].isPullRequest === true, '薄行与列表行同形（PR 行也带 isPullRequest）')
    const s2 = sessionOf(world)
    const stats2 = { thinQueries: 0 }
    const partial = await thinMod.fetchThinRows({ openSession: openerOf(s2.session), stats: stats2 }, CWD, { owner: 'o', name: 'r' }, ['7', '99'])
    check(partial && partial.ok === false && partial.outcome === 'failed' && partial.keys.length === 1 && partial.keys[0] === '99' && partial.reason === 'thin-query-failed', '一条没取到就整批不并（只报失败那条的号）')
    const stats3 = { thinQueries: 0 }
    const noSess = await thinMod.fetchThinRows({ openSession: async () => ({ ok: false, reason: 'no-registry' }), stats: stats3 }, CWD, { owner: 'o', name: 'r' }, ['7'])
    check(noSess && noSess.ok === false && noSess.outcome === 'failed' && /read-session-unavailable:no-registry/.test(noSess.reason), '开会话失败如实回 read-session-unavailable（不抛）')
    const empty = await thinMod.fetchThinRows({ openSession: async () => { throw new Error('不该被调到') }, stats: stats3 }, CWD, null, [])
    check(empty && empty.ok === true && empty.queries === 0 && empty.rows.length === 0, '没有要补的票时不开会话，直接回空批')
  }

  // ---- ⑤ 水印：扫描只算下一步，显式 commit 才前进，而且只许往前 ----
  {
    const nowIso = new Date(Date.now() - 30000).toISOString()
    const snap = { generatedMs: Date.now() - 60000, issues: [{ number: 7, state: 'OPEN', updatedAt: nowIso }] }
    const s = sessionOf({ pages: { '': { ok: true, data: { items: [issueOf(7, { updatedAt: nowIso })], nextCursor: null, total: 1 } } } })
    const list = listMod.createIssueList({
      getRepoKey: async () => ({ owner: 'o', name: 'r' }), setCache: () => {},
      issueIndexFromSnapshot: (x: any) => win.indexFromSnapshot(x), issueIndexChanged: () => false,
      rememberIssueIndex: () => {}, readDiskCache: async () => snap, openSession: openerOf(s.session),
    })
    const scan = await list.fetchIssueIndexWindowed(CWD)
    check(scan && scan.ok === true && scan.watermarkCommitted === false && scan.nextWatermarkMs > 0, '扫描只算出下一次水印，不自己推（watermarkCommitted=' + (scan && scan.watermarkCommitted) + '）')
    const cc = await list.commitIssueIndex(CWD, Date.now() + 1000, { 7: 'OPEN|' + nowIso })
    const cc2 = await list.commitIssueIndex(CWD, Date.now() - 100000)
    check(cc && cc.ok === true && cc.advanced === true && cc2 && cc2.ok === true && cc2.advanced === false, '显式 commit 只许往前走（先 true 后 false）')
  }

  // ---- ⑥ 静态：四条路径零直调 gh、零 gate.send，REST 导出已删 ----
  {
    const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l: string) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l }).join('\n')
    const files = ['issue-list-fetch.ts', 'issue-detail-fetch.ts', 'thin-row-fetch.ts']
    for (const name of files) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'refresh', 'rooms', 'host', name), 'utf8'))
      check(src.indexOf('runGh(') < 0, name + ' 里没有 runGh( 直调')
      check(src.indexOf('gate.send') < 0, name + ' 里没有 gate.send')
    }
    const list = listMod.createIssueList({ getRepoKey: async () => null, setCache: () => {}, issueIndexFromSnapshot: () => null, issueIndexChanged: () => false, rememberIssueIndex: () => {}, readDiskCache: async () => null })
    check(typeof list.fetchMapsDetailREST === 'undefined' && typeof list.fetchAllIssuesManual === 'undefined' && typeof list.fetchAllIndexManual === 'undefined', '地图 REST 兜底与两段手工分页已从回包删除')
    const detail = detailMod.createIssueDetail({ getRepoKey: async () => null })
    check(typeof detail.fetchIssueDetailREST === 'undefined', '详情 REST 直取口已从回包删除')
  }

  console.log('\n' + (failed ? '存在失败 — #1444 四条读路径门禁未通过' : '全部通过 — 四条读路径只走只读会话（' + total + ' 条断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e: any) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
