/**
 * tests/verify-1896-issue-detail-vm.ts —— 票详情页接到视图模型（#1896，规格 #1885 S6）
 *
 * 守什么（票面四条验收逐条落在这里）：
 *   A 正文、评论、评审与状态都来自视图模型：纯选择器 deckIssueDetailOf 收一份「详情投影 + 同一张票在
 *     投影里的行 + 评论加载态」，交出的切片里正文、评论节点、评审数组就是投影里那一份（连对象引用都相同）；
 *     状态优先取投影行（与列表同一把尺子），行不在时才退回详情自己的状态。
 *   B 生产接线与同一版本一致：deckViewOf 给出的 issueDetail 切片与列表 rows 切片对同一张票状态一致；
 *     同一版本再次采纳不重算这一片，换版本才重算；不打开任何票时如实说「不知道」。
 *   C 「加载更多」是视图模型的一个命令：命令触发一次读取（假端口计数；生产接线里是真的 wf.issueComments
 *     电话各一次），同一时刻再点一次不会再发；视图层不再直接发请求（静态判据 + 反证）。
 *   D 取数失败保留上次已知：详情取数失败、加载更多失败时，切片里的正文、评论、评审仍是上一次的值，
 *     界面照常画出来（不空白），失败只标在自己的字段上。
 *
 * 为什么能单独跑：视图模型与选择器都是纯数据层（不挂 React、不发电话）；C/D 两组的宿主电话用假宿主驱动，
 * 这一趟按规格「视图状态」那条接缝构造它、喂假投影与假电话，断言切片内容与命令结果。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1896-issue-detail-vm.ts
 */
// 门禁归属: src/client/kernel/deck-issue-detail.ts
// 门禁归属: src/client/kernel/deck-view-model.ts
// 门禁归属: src/client/kernel/deck-view-binding.ts
// 门禁归属: src/client/views/IssueDetail.ts
// 门禁归属: src/client/views/IssueDetailComments.ts

import { printGateResult } from './lib/gate-result.ts'
import { sourceText } from './lib/source-text.ts'

const GATE = 'verify-1896-issue-detail-vm'

let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

/** 去掉注释与字符串内容：只按代码形状判「这句还在不在」，注释里提到旧写法不算数。 */
function codeOnly(source: string): string {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

/**
 * 视图层直连宿主或自己发取数的形状：host.call( / rpcCall( / .call('wf.…) / fetchIssueComments( /
 * fetchIssueDetail(。最后一个由 #1885 评审补上：详情页原来自己调它，静态判据只扫前四个名字时漏了。
 */
function judgeDirectFetch(source: string): string[] {
  const code = codeOnly(source)
  const hits: string[] = []
  if (/\bhost\s*\.\s*call\s*\(/.test(code)) hits.push('host.call(')
  if (/\brpcCall\s*\(/.test(code)) hits.push('rpcCall(')
  if (/\.\s*call\s*\(\s*['"]wf\./.test(code)) hits.push(".call('wf.…)")
  if (/\bfetchIssueComments\s*\(/.test(code)) hits.push('fetchIssueComments(')
  if (/\bfetchIssueDetail\s*\(/.test(code)) hits.push('fetchIssueDetail(')
  return hits
}

function ticket(key: string, extra?: any): any {
  return Object.assign({
    key: key, number: Number(key), effortId: 'default', type: 'issue', title: '票 ' + key, state: 'OPEN',
    labels: [], assignees: [], blockedBy: [], updatedAt: '2026-11-01T00:00:00.000Z',
  }, extra || {})
}

function projectionOf(rows: any[], extra?: any): any {
  return Object.assign({ generatedMs: 1761900000000, issues: rows, maps: [], labels: [], thinTickets: [], workRouteTable: null }, extra || {})
}

const CLOCK = 1762310000000

/** 一张票的详情（宿主回包形状）：正文、评论、评审都在。 */
function detailOf(n: number, extra?: any): any {
  return Object.assign({
    number: n, effortId: 'default', title: '票 ' + n, state: 'OPEN',
    body: '票 ' + n + ' 的正文',
    comments: {
      nodes: [
        { author: { login: 'alice' }, body: '评论一', createdAt: '2026-11-01T00:00:00Z' },
        { author: { login: 'bob' }, body: '评论二', createdAt: '2026-11-02T00:00:00Z' },
      ],
      pageInfo: { hasNextPage: true, endCursor: '2' },
      totalCount: 5,
    },
    commentCount: 5,
    reviews: [{ author: { login: 'carol' }, state: 'APPROVED', body: '看过了' }],
    labels: { nodes: [] }, assignees: { nodes: [] }, blockedBy: { nodes: [] },
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  }, extra || {})
}

async function main(): Promise<void> {
  const { deckIssueDetailOf } = await import('../src/client/kernel/deck-issue-detail.ts')
  const { createDeckView, deckReadingOf } = await import('../src/client/kernel/deck-view-model.ts')

  // ------------------------------------------------------------------ A 切片由视图模型给出
  {
    const row = ticket('7', { state: 'CLOSED', title: '票 7（投影里的状态）' })
    const detail = detailOf(7)
    const view = { issue: detail, source: 'live', lastKnownAtMs: 0, noticeKey: '', notice: '', bodySlot: { kind: 'text', text: detail.body }, relationsNotice: '', commentsAvailable: true }
    const slice = deckIssueDetailOf({ number: 7, effortId: 'default', view: view, row: row, comments: { loading: false, failCount: 0 } })
    check(!!slice && slice.issue === detail, 'A1 切片里的详情就是视图模型收到的那一份（同一对象，不是重拼一份）', slice && slice.source)
    check(!!slice && slice.bodySlot === view.bodySlot && slice.bodySlot.text === detail.body, 'A2 正文来自视图模型（bodySlot 同一份）', slice && slice.bodySlot)
    check(!!slice && slice.comments.nodes === detail.comments.nodes && slice.comments.nodes.length === 2, 'A3 评论节点就是详情里的那两页之一（同一数组）', slice && slice.comments)
    check(!!slice && slice.comments.hasMore === true && slice.comments.total === 5, 'A4 「还有更多」与评论总数从详情连接上来', slice && slice.comments)
    check(!!slice && slice.reviews === detail.reviews && slice.reviews.length === 1 && slice.reviews[0].state === 'APPROVED', 'A5 评审数组原样在切片里（同一数组）', slice && slice.reviews)
    check(!!slice && slice.state === 'CLOSED' && slice.stateKnown === true, 'A6 状态取投影里的那一行（详情还写着 OPEN 也不算数）', slice && slice.state)

    const noRow = deckIssueDetailOf({ number: 7, effortId: 'default', view: view, row: null, comments: {} })
    check(!!noRow && noRow.state === 'OPEN' && noRow.stateKnown === true, 'A7 投影里没有这一行时退回详情自己的状态（不编一个）', noRow && noRow.state)

    const none = { issue: null, source: 'none', lastKnownAtMs: 0, noticeKey: '', notice: '', bodySlot: { kind: 'loading', caption: '' }, relationsNotice: '', commentsAvailable: false }
    const noView = deckIssueDetailOf({ number: 7, effortId: 'default', view: null, row: row, comments: {} })
    check(noView === null, 'A8 没有详情投影时返回 null（调用方退回旧投影，不拿投影行冒充详情）', noView)
    const emptySlice = deckIssueDetailOf({ number: 7, effortId: 'default', view: none, row: row, comments: { loading: true, failCount: 2 } })
    check(!!emptySlice && emptySlice.comments.nodes.length === 0 && emptySlice.comments.unknown === false && emptySlice.comments.loading === true && emptySlice.comments.failCount === 2,
      'A9 没有详情时评论是空数组、加载态与失败次数照实带出（不补假数据）', emptySlice && emptySlice.comments)

    const frozen = JSON.stringify(deckIssueDetailOf({ number: 7, effortId: 'default', view: view, row: row, comments: { loading: false, failCount: 0 } }))
    const again = JSON.stringify(deckIssueDetailOf({ number: 7, effortId: 'default', view: view, row: row, comments: { loading: false, failCount: 0 } }))
    check(frozen === again, 'A10 同一份输入连续两次给出的切片逐字相同（纯选择器，不读时钟）')

    const unknownComments = { issue: Object.assign({}, detail, { comments: undefined }), source: 'snapshot', lastKnownAtMs: CLOCK, noticeKey: 'detail.lastKnownData', notice: '上次数据', bodySlot: { kind: 'text', text: '正文' }, relationsNotice: '', commentsAvailable: false }
    const unknownSlice = deckIssueDetailOf({ number: 7, effortId: 'default', view: unknownComments, row: row, comments: {} })
    check(!!unknownSlice && unknownSlice.comments.unknown === true && unknownSlice.comments.known === false, 'A11 从库读回来但评论还没取过：切片说「未知」，不说「没有」', unknownSlice && unknownSlice.comments)
  }

  // ------------------------------------------------------------------ B 生产接线 + 同一版本列表一致
  {
    const storeMap: Record<string, string> = {}
    ;(globalThis as any).localStorage = {
      getItem: function (k: string) { return Object.prototype.hasOwnProperty.call(storeMap, k) ? storeMap[k] : null },
      setItem: function (k: string, v: string) { storeMap[k] = String(v) },
      removeItem: function (k: string) { delete storeMap[k] },
    }
    ;(globalThis as any).tr = function (key: any, params?: any) {
      let s: string = String(key)
      if (params) s = s.replace(/\{(\w+)\}/g, function (_m: string, n: string) { return n in params ? String(params[n]) : _m })
      return s
    }
    ;(globalThis as any).idOfParts = function (a: any, b: any) { return String(a) + '\u0000' + String(b) }
    ;(globalThis as any).log = function () {}
    ;(globalThis as any).emit = function () {}
    ;(globalThis as any).createDeckView = createDeckView
    ;(globalThis as any).deckFiltersOf = (await import('../src/client/kernel/deck-view-model.ts')).deckFiltersOf
    ;(globalThis as any).deckReadingOf = deckReadingOf
    ;(globalThis as any).deckIssueDetailOf = deckIssueDetailOf
    const projectionModule: any = await import('../src/client/views/shared/detailProjection.ts')
    ;(globalThis as any).detailViewFor = projectionModule.detailViewFor
    ;(globalThis as any).snapshotRowFor = projectionModule.snapshotRowFor
    ;(globalThis as any).projectionUsesSnapshot = projectionModule.projectionUsesSnapshot
    const binding: any = await import('../src/client/kernel/deck-view-binding.ts')

    const row7 = ticket('7', { state: 'CLOSED', title: '票 7（投影里的状态）' })
    const row8 = ticket('8')
    const projection = projectionOf([row7, row8])
    let version = 5
    let navTop: any = { kind: 'issue', n: 7, effortId: 'default' }
    const host = { call: function (method: string, args: any): any { return Promise.resolve({ ok: true, nodes: [], pageInfo: { hasNextPage: false } }) } }
    const scope: any = {
      host: host,
      peekNav: function (): any { return navTop },
      detailViewFor: projectionModule.detailViewFor,
      snapshotRowFor: projectionModule.snapshotRowFor,
      projectionUsesSnapshot: projectionModule.projectionUsesSnapshot,
      fetchIssueComments: null,
      idOfParts: (globalThis as any).idOfParts,
      ticketRowsOf: function (a: any): any[] { return a || [] },
      issuePageRowsOf: function (): any[] { return [] },
      isOccupied: function (): boolean { return false },
      occCount: function (): number { return 0 },
      deckCountsOf: function (): any { return null },
      bugCount: function (): number { return 0 },
      triageCount: function (): number { return 0 },
      kpiCountsOf: function (): any { return { takeable: 0, closed: 0, unknown: false, pending: false, atMs: 0, source: 'local-enumeration' } },
      listPrefs: { stateFilter: 'all', sortKey: 'number', sortDir: 'asc' },
      saveListPrefs: function (): void {},
      wsKeyOf: function (k: any): string { return String(k || '') },
      snapshotVersionBookOf: function (): any { return { version: version, seenAtMs: 0 } },
    }
    const st: any = {
      cwd: 'D:/ws/vm', snapshot: projection, sessionId: 's1', detailSeenAt: {}, issueCache: {},
      stateFilter: 'all', lblFilters: [], effFilters: [], sortKey: 'number', sortDir: 'asc', expLabels: false,
      activeIssue: 7, activeEffortId: 'default', navStack: [], cmtDraft: '',
      issueDetail: detailOf(7), issueMode: 'real', issueError: null,
    }
    binding.deckViewForgetFrames()
    const view = binding.deckViewOf(st, scope)
    const slice = view.slice('issueDetail')
    check(!!slice && slice.number === 7 && slice.issue === st.issueDetail && slice.source === 'live',
      'B1 生产接线按当前打开的票给出详情切片（详情是这一趟取回的那一份）', slice && { number: slice.number, source: slice.source })
    check(!!slice && slice.state === 'CLOSED' && slice.stateKnown === true,
      'B2 详情里还写着 OPEN 时，切片仍按投影行说 CLOSED（状态只认一处）', slice && slice.state)
    const rows = view.slice('rows')
    const listRow = (rows.closed || []).filter(function (t: any): boolean { return Number(t.number) === 7 })[0]
    check(listRow === row7 && String(listRow.state) === slice.state,
      'B3 列表切片里同一张票就是投影里的那一行，状态与详情切片相同（同一版本下不会各说各的）', listRow && listRow.state)
    check((rows.open || []).filter(function (t: any): boolean { return Number(t.number) === 8 })[0] === row8,
      'B4 另一张开放的票在列表里照旧是开放（没有把整列状态一起改掉）')
    const sliceRef = slice
    const sliceVer = view.versionOf('issueDetail')
    binding.deckViewOf(st, scope)
    check(view.slice('issueDetail') === sliceRef && view.versionOf('issueDetail') === sliceVer,
      'B5 同一版本再取一次：详情切片连对象引用都不换（复用，不重算）', { ver: view.versionOf('issueDetail') })
    version = 6
    row7.state = 'OPEN'
    st.snapshot = projectionOf([row7, row8])
    binding.deckViewOf(st, scope)
    const next = view.slice('issueDetail')
    check(next !== sliceRef && next.state === 'OPEN', 'B6 换到新版本才重算：状态跟着投影行一起变成 OPEN', next && next.state)
    check((view.slice('rows').open || []).filter(function (t: any): boolean { return Number(t.number) === 7 }).length === 1,
      'B7 同一份新投影上列表也把这张票算成开放（两边一起变，不是各变各的）')
    navTop = null
    st.activeIssue = null
    binding.deckViewOf(st, scope)
    const noTicket = view.slice('issueDetail')
    check(!!noTicket && noTicket.issue === null && noTicket.source === 'none' && noTicket.stateKnown === false,
      'B8 没有打开任何票时如实说「不知道」（不拿上一张票的详情冒充）', noTicket && { issue: noTicket.issue, source: noTicket.source })
    navTop = { kind: 'issue', n: 7, effortId: 'default' }
    st.activeIssue = 7
    st.issueMode = 'err'
    st.issueError = { kind: 'network', message: '断网' }
    binding.deckViewOf(st, scope)
    const kept = view.slice('issueDetail')
    check(!!kept && kept.issue === st.issueDetail && kept.comments.nodes.length === 2 && kept.bodySlot && kept.bodySlot.text === st.issueDetail.body,
      'B9 详情取数失败时切片保留上一次的正文与评论（issueMode=err 不清空）', kept && { source: kept.source, nodes: kept.comments.nodes.length })
    binding.deckViewForgetFrames()
  }

  // ------------------------------------------------------------------ C 「加载更多」是视图模型的命令
  {
    // C1/C2 纯层：命令只替视图喊一次读取，上一页还在路上时不重复喊。
    const calls: any[] = []
    const view: any = createDeckView({
      frame: { key: 'ws|5', version: 5, projection: projectionOf([ticket('7')]), counts: { total: 1 }, readout: { version: 5 } },
      reading: { activeIssue: 7, activeIssueEffort: 'default' },
      detail: { loading: false, failCount: 0 },
      ports: {
        issueDetailOf: function (_f: any, _r: any, d: any): any { return { comments: { nodes: [], loading: !!(d && d.loading), failCount: Number((d && d.failCount) || 0) } } },
        loadMoreComments: function (payload: any): any { calls.push(payload); return Promise.resolve({ ok: true }) },
      },
    })
    view.command('loadMoreComments', { after: '2' })
    check(calls.length === 1 && calls[0].number === 7 && calls[0].effortId === 'default' && calls[0].after === '2',
      'C1 命令触发一次读取：票号与工作单元从阅读态来、游标从调用方来', calls)
    view.adopt({ detail: { loading: true, failCount: 0 } })
    check(view.slice('issueDetail').comments.loading === true, 'C2 读取在途时切片说「加载中」（按钮据此置灰）', view.slice('issueDetail').comments)
    view.command('loadMoreComments', { after: '2' })
    check(calls.length === 1, 'C3 上一页还在路上时再点一次不再发读取（节流，不重复取）', calls.length)

    // C4-C6 生产接线：命令背后真的只有一条 wf.issueComments 电话，失败与成功都落回切片。
    ;(globalThis as any).isEnabled = function (): boolean { return false }
    ;(globalThis as any).dswsLogHash = function (s: any): string { return String(s) }
    ;(globalThis as any).dswsLogTrunc = function (s: any): string { return String(s) }
    ;(globalThis as any).scheduleActionProbe = function (): void {}
    ;(globalThis as any).loadSnapshot = function (): void {}
    ;(globalThis as any).ISSUE_CACHE_TTL = 60000
    ;(globalThis as any).projectionUsesSnapshot = function (): boolean { return true }
    const api: any = await import('../src/client/kernel/api-io.ts')
    const binding: any = await import('../src/client/kernel/deck-view-binding.ts')
    const projectionModule: any = await import('../src/client/views/shared/detailProjection.ts')

    const phones: any[] = []
    let reply: any = { ok: false, error: { kind: 'network', message: '断网' } }
    const host = { call: function (method: string, args: any): any { phones.push({ method: method, args: args }); return Promise.resolve(reply) } }
    ;(globalThis as any).host = host
    let navTop: any = { kind: 'issue', n: 7, effortId: 'default' }
    const scope: any = {
      host: host,
      fetchIssueComments: api.fetchIssueComments,
      peekNav: function (): any { return navTop },
      detailViewFor: projectionModule.detailViewFor,
      snapshotRowFor: projectionModule.snapshotRowFor,
      projectionUsesSnapshot: function (): boolean { return true },
      idOfParts: (globalThis as any).idOfParts,
      ticketRowsOf: function (a: any): any[] { return a || [] },
      issuePageRowsOf: function (): any[] { return [] },
      isOccupied: function (): boolean { return false },
      occCount: function (): number { return 0 },
      deckCountsOf: function (): any { return null },
      bugCount: function (): number { return 0 },
      triageCount: function (): number { return 0 },
      kpiCountsOf: function (): any { return { takeable: 0, closed: 0, unknown: false, pending: false, atMs: 0, source: 'local-enumeration' } },
      listPrefs: { stateFilter: 'all', sortKey: 'number', sortDir: 'asc' },
      saveListPrefs: function (): void {},
      wsKeyOf: function (k: any): string { return String(k || '') },
      snapshotVersionBookOf: function (): any { return { version: 8, seenAtMs: 0 } },
    }
    const st: any = {
      cwd: 'D:/ws/vm', snapshot: projectionOf([ticket('7')]), sessionId: 's1', detailSeenAt: {}, issueCache: {},
      stateFilter: 'all', lblFilters: [], effFilters: [], sortKey: 'number', sortDir: 'asc', expLabels: false,
      activeIssue: 7, activeEffortId: 'default', cmtDraft: '',
      issueDetail: detailOf(7), issueMode: 'real', issueError: null,
    }
    binding.deckViewForgetFrames()
    const model: any = binding.deckViewOf(st, scope)
    const before: any = model.slice('issueDetail')
    check(!!before && before.comments.nodes.length === 2 && before.comments.hasMore === true,
      'C4 接线后的切片一开始拿着详情里的两条评论与「还有更多」', before && before.comments)
    binding.deckViewCommand(st, 'loadMoreComments', { number: 7, effortId: 'default', after: '2' }, scope)
    await new Promise(function (resolve: any): any { setTimeout(resolve, 0) })
    const cmCalls = phones.filter(function (p: any): boolean { return p.method === 'wf.issueComments' })
    check(cmCalls.length === 1 && cmCalls[0].args && Number(cmCalls[0].args.number) === 7 && String(cmCalls[0].args.after) === '2' && String(cmCalls[0].args.effortId) === 'default',
      'C5 一次命令只发一条 wf.issueComments 电话（视图自己没有电话可发）', cmCalls)
    binding.deckViewOf(st, scope)
    const failedSlice: any = model.slice('issueDetail')
    check(!!failedSlice && failedSlice.comments.failCount === 1 && failedSlice.comments.nodes.length === 2 && failedSlice.comments.nodes === before.comments.nodes && String(failedSlice.issue.body).length > 0,
      'C6 加载更多失败：切片保留上一次的评论与正文，只把失败次数记下来', failedSlice && failedSlice.comments)

    reply = { ok: true, nodes: [{ author: { login: 'dave' }, body: '评论三' }, { author: { login: 'erin' }, body: '评论四' }], pageInfo: { hasNextPage: false, endCursor: '4' } }
    st.issueCommentsFailCount = 0
    binding.deckViewOf(st, scope)
    binding.deckViewCommand(st, 'loadMoreComments', { number: 7, effortId: 'default', after: '2' }, scope)
    await new Promise(function (resolve: any): any { setTimeout(resolve, 0) })
    binding.deckViewOf(st, scope)
    const after: any = model.slice('issueDetail')
    check(!!after && after.comments.nodes.length === 4 && after.comments.hasMore === false && after.comments.failCount === 0,
      'C7 加载更多成功：切片的评论长到四条、不再有下一页（数据仍然只从视图模型来）', after && after.comments)
    check(phones.filter(function (p: any): boolean { return p.method === 'wf.issueComments' }).length === 2, 'C8 两次命令一共两条电话（没有额外取数）', phones.length)
    binding.deckViewForgetFrames()
  }

  // ------------------------------------------------------------------ C9+ 视图层不再直接发请求（静态）
  {
    const detailView = sourceText('src/client/views/IssueDetail.ts')
    const commentsView = sourceText('src/client/views/IssueDetailComments.ts')
    check(detailView.indexOf("useDeckViewSlice(st, 'issueDetail')") >= 0,
      'C9 详情页从视图模型的 issueDetail 切片取这一屏的数据（正文、评论、评审、状态）')
    check(detailView.indexOf("deckViewCommand(st, 'loadIssueDetail'") >= 0,
      'C9b 详情页的首取与重试都走视图模型命令 loadIssueDetail（视图不直接调取数函数）')
    check(commentsView.indexOf("deckViewCommand(st, 'loadMoreComments'") >= 0,
      'C10 评论区的「加载更多」走视图模型命令，不再自己调取数函数')
    const direct: any = {}
    for (const [rel, text] of [['src/client/views/IssueDetail.ts', detailView], ['src/client/views/IssueDetailComments.ts', commentsView]]) {
      const hits = judgeDirectFetch(text)
      if (hits.length) direct[rel] = hits
    }
    check(Object.keys(direct).length === 0,
      'C11 两个迁移过的详情页文件都不直连宿主电话、也不自己发取数（host.call( / rpcCall( / .call(wf.…) / fetchIssueComments( / fetchIssueDetail(）', direct)
    const selfCheck1 = judgeDirectFetch("export const x = function () { return fetchIssueComments(st, 9, '1', {}) }")
    const selfCheck2 = judgeDirectFetch("host.call('wf.issueComments', { number: 9 })")
    const selfCheck3 = judgeDirectFetch("const p = rpcCall('wf.issueComments', {})")
    const selfCheck4 = judgeDirectFetch("if (typeof fetchIssueDetail === 'function') fetchIssueDetail(st, 9, {})")
    check(selfCheck1.length === 1 && selfCheck2.length === 1 && selfCheck3.length === 1 && selfCheck4.length === 1,
      'C12 反证：自己取评论、直连宿主、rpc、自己取详情四种写法都会被这道静态判据当场抓住', { selfCheck1, selfCheck2, selfCheck3, selfCheck4 })
    check(judgeDirectFetch("// 以前这里调过 fetchIssueComments(st) 与 host.call('wf.issueComments')").length === 0,
      'C13 注释里提到旧写法不算直连（判据只看代码形状）')
    const binding = sourceText('src/client/kernel/deck-view-binding.ts')
    check(binding.indexOf('loadMoreComments') >= 0 && binding.indexOf('fetchIssueComments') >= 0,
      'C14 命令背后的那趟读取接在接线层里（视图不碰它，接线层才是打电话的地方）')
  }

  // ------------------------------------------------------------------ D 失败保留上次已知、界面不空白
  {
    const React: any = (await import('react')).default
    const { renderToStaticMarkup } = await import('react-dom/server')
    ;(globalThis as any).React = React
    ;(globalThis as any).h = React.createElement
    ;(globalThis as any).Ic = function (props: any) { return '[' + ((props && props.n) || '?') + ']' }
    ;(globalThis as any).Tip = function (props: any) { return React.createElement('span', { 'data-tip': String(props.content) }, props.children) }
    ;(globalThis as any).peekNav = function (): any { return null }
    ;(globalThis as any).repoStr = function (): string { return '' }
    ;(globalThis as any).useIssueDetailFold = function (): any { return null }
    ;(globalThis as any).findMapByIdentity = function (): any { return null }
    ;(globalThis as any).pushNav = function (): void {}
    ;(globalThis as any).popNav = function (): void {}
    ;(globalThis as any).copyText = function (): any { return Promise.resolve(true) }
    ;(globalThis as any).openInNewSession = function (): void {}
    ;(globalThis as any).inject = function (): void {}
    ;(globalThis as any).buildColorOf = function (): any { return {} }
    ;(globalThis as any).rowActionText = function (): string { return '' }
    ;(globalThis as any).rowActionKind = function (): string { return '' }
    ;(globalThis as any).actionColorOf = function (): string { return '#8b949e' }
    ;(globalThis as any).isLightHex = function (): boolean { return false }
    ;(globalThis as any).hexA = function (): string { return '' }
    ;(globalThis as any).darken = function (): string { return '' }
    ;(globalThis as any).effortNamesOf = function (): any[] { return [] }
    ;(globalThis as any).enterSubDetail = function (): void {}
    ;(globalThis as any).containerKindOf = function (): any { return null }
    ;(globalThis as any).containerStateOf = function (): string { return 'open' }
    ;(globalThis as any).containerTriState = function (): any { return null }
    ;(globalThis as any).ISSUE_DETAIL_CONFIRM_MS = 1500
    ;(globalThis as any).CONTAINER_ACCENT = { map: '#bc8cff' }
    ;(globalThis as any).MOTION = { inlineSpinnerMs: 700 }
    ;(globalThis as any).detailTopGate = (await import('../src/client/kernel/detail-top-gate.ts')).detailTopGate
    ;(globalThis as any).prStateKind = (await import('../src/client/views/shared/stateKind.ts')).prStateKind
    const ticketLabel: any = await import('../src/client/kernel/ticket-label.ts')
    ;(globalThis as any).ticketLabelOf = ticketLabel.ticketLabelOf
    ;(globalThis as any).ticketLabelNodesOf = ticketLabel.ticketLabelNodesOf
    ;(globalThis as any).TICKET_LABEL_MAX_WIDTH = ticketLabel.TICKET_LABEL_MAX_WIDTH
    ;(globalThis as any).ticketBadgeOf = (await import('../src/client/views/shared/ticketBadge.ts')).ticketBadgeOf
    const link: any = await import('../src/client/kernel/link.ts')
    ;(globalThis as any).issueUrlFor = link.issueUrlFor
    ;(globalThis as any).openIssueUrl = link.openIssueUrl
    ;(globalThis as any).openModeFor = link.openModeFor
    ;(globalThis as any).openTrackerTarget = link.openTrackerTarget
    const md: any = await import('../src/client/views/shared/md.ts')
    ;(globalThis as any).mdToHtml = md.mdToHtml
    ;(globalThis as any).mdImgOverlay = md.mdImgOverlay
    ;(globalThis as any).issueErrorViewOf = (await import('../src/client/views/issueDetailErrorView.ts')).issueErrorViewOf
    const projectionModule: any = await import('../src/client/views/shared/detailProjection.ts')
    ;(globalThis as any).knownBlockedNodes = projectionModule.knownBlockedNodes
    ;(globalThis as any).effortOf = (await import('../src/tracker/kernel/identity-keys.ts')).effortOf
    ;(globalThis as any).renderIssueDetailComments = (await import('../src/client/views/IssueDetailComments.ts')).renderIssueDetailComments
    // 门禁里这一片按真切片喂进去（生产里它是订阅来的）：页面只认切片，不自己挑字段。
    let currentSlice: any = null
    ;(globalThis as any).useDeckViewSlice = function (_st: any, name: string): any { return name === 'issueDetail' ? currentSlice : null }
    const { DswsCtx, createCx } = await import('../src/client/kernel/ctx.ts')
    ;(globalThis as any).DswsCtx = DswsCtx
    const services: any = {
      slots: { register: () => () => {}, inject: (_n: string, fn: any) => { try { fn() } catch (e) {} } },
      locale: { register: () => () => {}, bind: () => (globalThis as any).tr },
      timer: { timeout: (fn: any, ms: any) => setTimeout(fn, ms) },
    }
    const fakeStore: any = { snapshot: null, sessionId: 'test', tab: 'list', cwd: 'D:/ws', issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false } }
    const fakeCx: any = createCx({
      ctx: { get: (k: any) => services[k], effect: (fn: any) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (_d: any, cb: any) => { cb({ get: (k: any) => services[k] }); return { dispose: () => {} } } },
      h: React.createElement,
      rdom: {},
      storeSvc: { shared: fakeStore, stores: {}, makeStore: () => fakeStore, storeOf: () => fakeStore, emit: () => {}, sub: () => () => {}, useStore: () => fakeStore },
      localeSvc: services.locale,
      timer: services.timer,
      api: { call: async () => ({ ok: true }), inject: () => {}, copyText: async () => {} },
      router: { open: () => {}, toggle: () => {} },
    } as any)
    const { IssueDetail } = await import('../src/client/views/IssueDetail.ts')

    const row = ticket('7', { state: 'CLOSED' })
    const projection = projectionOf([row])
    function renderWith(issueDetail: any, mode: string, error: any): { html: string, slice: any } {
      const st: any = {
        cwd: 'D:/ws', activeIssue: 7, activeEffortId: 'default', navStack: [],
        snapshot: projection, issueDetail: issueDetail, issueMode: mode, issueError: error,
        detailSeenAt: {}, issueCache: {}, stateFilter: 'all', lblFilters: [], effFilters: [], sortKey: 'number', sortDir: 'asc',
      }
      currentSlice = deckIssueDetailOf({
        number: 7, effortId: 'default', row: row,
        view: projectionModule.detailViewFor({ snapshot: projection, issueDetail: issueDetail, issueMode: mode, issueError: error, detailSeenAt: {}, issueCache: {} }, 7, 'default'),
        comments: { loading: false, failCount: 0 },
      })
      const html = renderToStaticMarkup(React.createElement(DswsCtx.Provider as any, { value: fakeCx }, React.createElement(IssueDetail as any, { st })))
      return { html: html, slice: currentSlice }
    }

    const good = renderWith(detailOf(7), 'real', null)
    check(good.html.indexOf('票 7 的正文') >= 0, 'D1 页面把视图模型里的正文画出来（不是空白）')
    check(good.html.indexOf('评论一') >= 0 && good.html.indexOf('评论二') >= 0, 'D2 页面把视图模型里的评论画出来')
    check(good.html.indexOf('list.state.closed') >= 0 && good.html.indexOf('list.state.open') < 0,
      'D3 状态按视图模型说「已关闭」（详情还写着 OPEN 也不改口，与列表同一个状态）', good.html.slice(0, 200))
    check(!!good.slice && good.slice.reviews.length === 1 && good.slice.reviews[0].state === 'APPROVED',
      'D4 评审也在视图模型切片里（页面要画时不用再另取一份）', good.slice && good.slice.reviews)

    const failed = renderWith(detailOf(7), 'err', { kind: 'network', message: '断网了' })
    check(failed.html.indexOf('票 7 的正文') >= 0 && failed.html.indexOf('评论一') >= 0,
      'D5 详情取数失败时正文与评论照旧画出来（保留上次已知，界面不空白）')
    check(failed.html.indexOf('detail.err.retry.banner') >= 0 || failed.html.indexOf('断网了') >= 0,
      'D6 失败只在横幅上标出来（内容还在，不拿空白冒充失败）', failed.html.slice(0, 160))

    const noDetail = renderWith(null, 'loading', null)
    check(noDetail.html.indexOf('票 7 的正文') < 0 && noDetail.html.indexOf('<textarea') < 0,
      'D7 真的没有详情时不造正文、也不给评论输入框（不知道就是不知道）')
  }
}

main().then(function (): void {
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}, function (err: any): void {
  console.error('门禁脚本自身出错：', err)
  printGateResult(GATE, total, failed + 1)
  process.exit(1)
})