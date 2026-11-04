// verify-524-pr-detail.ts —— #524 回归探针：拉取请求详情与普通工单详情走同一趟只读会话
// 历史：旧详情房只查普通工单，拉取请求页签点 #106 必红 notFound；后来补了「先工单、再拉取请求、最后 REST」。
// #1444 起详情改走 Tracker 只读会话的 get（房间内部自己先工单、再拉取请求，并在失败时退 REST）。
// #1870：旧的单票详情直取模块（issue-detail-fetch.ts）退役，这一条改成驱动生产里那条
// comment-thread-fetch.handleIssueDetail（本地快照库优先、库里没有才经会话 get），判据保持不变：
// 标记对不对、失败是否如实、以及这一路一次外部命令都不发。
//
// #1870：拉取请求的 isPullRequest / mergedAt / reviews 三格现在就在这条宿主方法的回包里。
// 从前它逐字段挑，把三格丢掉了，界面只能回落到快照行（IssueDetail 的 fromPullRequest 与
// detailProjection 的 reviews）——第一次点开一张拉取请求时，「这是 PR、只读、已合并」全靠那一行凑，
// 详情回包自己说不出来。现在按契约原样交回：字段在就写（false / null / [] 都是明确知道），
// 不在就整个省掉（不知道）。
//
// 运行：node --import ./scripts/ts-hook.mts tests/verify-524-pr-detail.ts
import path from 'node:path'
import { pathToFileURL } from 'node:url'
let pass = 0
let fail = 0
const check = (ok: unknown, msg: string) => { if (!ok) { fail++; console.error('FAIL', msg) } else { pass++; console.log('PASS', msg) } }

async function main() {
  const ROOT = path.resolve(import.meta.dirname, '..')
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/refresh/rooms/host/comment-thread-fetch.js')).href)

  // 契约票（房间 get 回来的那一份）：评论与评审都用契约自己的字段名（评论 author 是 Actor，评审是 reviewer）。
  const contractIssue = (over: any) => Object.assign({
    key: '106', effortId: 'e', type: 'issue', title: '标题', state: 'closed', body: '正文',
    url: 'https://x/pull/106', createdAt: 'c', updatedAt: 'u', closedAt: 'd', parentKey: null,
    author: { login: 'a' }, labels: [], assignees: [],
    comments: [{ author: { login: 'c1' }, authorAssociation: 'MEMBER', body: '评论', createdAt: 'c1t', updatedAt: 'c1u' }],
    blockedBy: [{ key: '7', title: '阻塞票', state: 'open' }], isPullRequest: true, mergedAt: null,
    reviews: [{ state: 'APPROVED', reviewer: { login: 'rv' }, submittedAt: 'rv-t' }],
  }, over)

  function stub() {
    const gets: any[] = []
    const execs: string[] = []
    const session: any = {
      get: async (ref: any, key: any, opts: any, ctx: any) => {
        gets.push({ ref: ref, key: key, opts: opts, ctx: ctx })
        const n = Number(key)
        if (n === 999999) return { ok: false, error: { kind: 'notFound', message: '找不到 #' + n, raw: '' } }
        if (n === 106) return { ok: true, data: contractIssue({}) }
        return { ok: true, data: contractIssue({ key: String(n), number: n, title: '工单标题', state: 'open', url: 'https://x/issues/' + n, isPullRequest: false, mergedAt: null, reviews: [], blockedBy: [] }) }
      },
    }
    const h = mod.createCommentThreads({
      normCwd: async (c: any) => c,
      errText: (e: any) => String((e && e.message) || e),
      // 详情读路径不许直调外部命令：走到这里就说明有人把会话绕开了。
      execProc: async () => { execs.push('exec'); throw new Error('详情房不该再直调 gh') },
      setCache: () => {}, getCache: () => null,
      openSession: async (cwd: string) => ({
        ok: true,
        backendId: 'github',
        repoRef: { backend: 'github', refId: 'o/r', name: 'o/r', url: '' },
        call: (fn: any) => fn(session, { cwd: cwd, caller: 'refresh' }),
      }),
    })
    return { h, gets, execs }
  }

  {
    const { h, gets, execs } = stub()
    const r = await h.handleIssueDetail({ number: 106, cwd: 'cwd' })
    check(r && r.ok === true && r.issue && r.issue.number === 106 && r.issue.state === 'CLOSED', '拉取请求号变绿（会话 get 命中，号对、状态大写）')
    check(r && r.issue && r.issue.comments && r.issue.comments.nodes.length === 1 && r.issue.comments.nodes[0].author.login === 'c1', '评论按 {nodes} 连接交回（作者登录名原样）')
    check(r && r.issue && r.issue.comments.pageInfo && r.issue.comments.pageInfo.hasNextPage === false, '评论连接仍带 pageInfo（界面按它决定有没有「加载更多」）')
    check(gets.length === 1 && gets[0].opts && gets[0].opts.comments && gets[0].opts.comments.first === 50, '评论只要一页 50 条（不扩契约：加载更多仍走 fetchIssueComments）')
    check(gets[0].ctx && gets[0].ctx.caller === 'refresh' && gets[0].ref.refId === 'o/r', '会话上下文带 caller=refresh，仓库坐标是 owner/name')
    check(r.issue.blockedBy && r.issue.blockedBy.nodes.length === 1 && r.issue.blockedBy.nodes[0].number === 7 && r.issue.blockedBy.nodes[0].state === 'OPEN', '阻塞边回详情页认的 {nodes:[{number,title,state}]} 形状（来自这一趟 get 自带的那一份）')
    check(execs.length === 0, '这一趟一次外部命令都没发（实发 ' + execs.length + ' 次）')
    // 三格：第一次点开就能从回包本身看出这是拉取请求（不再依赖快照行）。
    check(r.issue.isPullRequest === true, '回包直说这是拉取请求（界面不必再回落到快照行）')
    check(r.issue.mergedAt === null, '合并时间照契约给：还没合并是 null（明确知道，不是不知道）')
    check(Array.isArray(r.issue.reviews) && r.issue.reviews.length === 1 && r.issue.reviews[0].state === 'APPROVED' && r.issue.reviews[0].reviewer.login === 'rv' && r.issue.reviews[0].submittedAt === 'rv-t', '评审按界面认的形状交回（结论 + 评审人登录名 + 时间）')
  }
  {
    const { h } = stub()
    const r = await h.handleIssueDetail({ number: 7, cwd: 'cwd' })
    check(r && r.ok === true && r.issue && r.issue.number === 7 && r.issue.state === 'OPEN', '普通工单号仍绿（会话 get 命中，不误标状态）')
    check(r && r.issue && r.issue.subIssues && Array.isArray(r.issue.subIssues.nodes), '子票连接照旧带（清单仍由快照/地图那条路提供）')
    check(r.issue.isPullRequest === false, '普通工单明确写 false（与「不知道」分得开）')
    check(Array.isArray(r.issue.reviews) && r.issue.reviews.length === 0, '没有评审给空数组（明确知道），不是省掉这一格')
  }
  {
    // 契约没表达这三格的后端（本地 Markdown 这类没有拉取请求能力的）：回包也不许凭空写，
    // 界面据此说「不知道」，而不是把它说成「不是 PR」「没有评审」。
    const noPrSession: any = {
      get: async () => ({
        ok: true,
        data: { key: '5', effortId: 'e', type: 'issue', title: '标题', state: 'open', body: '', url: '', createdAt: 'c', updatedAt: 'u', closedAt: null, parentKey: null },
      }),
    }
    const h = mod.createCommentThreads({
      normCwd: async (c: any) => c,
      errText: (e: any) => String((e && e.message) || e),
      execProc: async () => ({}),
      setCache: () => {}, getCache: () => null,
      openSession: async (cwd: string) => ({
        ok: true, backendId: 'markdown', repoRef: { backend: 'markdown', refId: 'ws', name: 'ws', url: '' },
        call: (fn: any) => fn(noPrSession, { cwd: cwd }),
      }),
    })
    const r = await h.handleIssueDetail({ number: 5, cwd: 'cwd' })
    check(r && r.ok === true, '后端没有拉取请求能力时详情照常回')
    check(r.issue.isPullRequest === undefined && r.issue.mergedAt === undefined && r.issue.reviews === undefined, '契约没表达时不写这三格（不知道 ≠ 不是 PR / 没有评审）')
  }
  {
    const { h, execs } = stub()
    const r = await h.handleIssueDetail({ number: 999999, cwd: 'cwd' })
    check(r && r.ok === false && /notFound|404/.test(String((r.error && (r.error.kind || r.error.message)) || '')), '坏号仍诚实未找到（会话回 notFound，不误报成功）')
    check(execs.length === 0, '坏号也不退回直调外部命令（实发 ' + execs.length + ' 次）')
  }
  {
    const h = mod.createCommentThreads({ normCwd: async (c: any) => c, errText: (e: any) => String((e && e.message) || e), execProc: async () => ({}), setCache: () => {}, getCache: () => null })
    const r = await h.handleIssueDetail({ number: 7, cwd: 'cwd' })
    check(r && r.ok === false && r.error && r.error.kind === 'env', '没注入会话时如实回失败（不许假装成功）')
    check(Object.keys(h).sort().join(',') === 'handleCommentIssue,handleIssueComments,handleIssueDetail', '详情这条宿主方法只交三件（没有第二条直取口，REST 降级只在房间内部）', Object.keys(h).sort().join(','))
  }
  {
    // 库来源那条路：同样按三态交，两条来源必须同形（#1870）。
    // 库里没记 is_pull_request、合并信息组也没取过 → 两格都省掉（不知道），不写 false / null。
    const projection = (over: any) => Object.assign({
      key: '7', effortId: '', referenceSkeleton: false, lastKnownAtMs: Date.now(),
      row: {
        type: 'issue', title: '标题', state: 'open', url: '', createdAtMs: null, updatedAtMs: null, closedAtMs: null,
        stateReason: null, isPullRequest: null, commentCount: null, milestoneJson: null, customFieldsJson: null,
        status: null, statusVisible: null, statusSource: null, statusConflictJson: null,
      },
      labels: [], assignees: [], blockedBy: [], blocking: [], children: [], subIssues: null,
      mergedAtMs: null, body: null, comments: [], reviews: [], commentsCursor: null,
      groups: {
        row: { completeness: 'complete', reason: null, lastQueriedMs: Date.now() },
        body: null, labels: null, assignees: null, parents: null, blockedBy: null,
        subIssues: null, mergeInfo: null, comments: null, review: null,
      },
    }, over)
    const withLib = (issue: any) => mod.createCommentThreads({
      normCwd: async (c: any) => c,
      errText: (e: any) => String((e && e.message) || e),
      execProc: async () => { throw new Error('库命中时不该发命令') },
      setCache: () => {}, getCache: () => null,
      openSession: async (cwd: string) => ({
        ok: true, backendId: 'github', repoRef: { backend: 'github', refId: 'o/r', name: 'o/r', url: '' },
        // 库命中就不该再问会话：走到这里说明本地优先白写了。
        call: () => { throw new Error('库命中时不该再取数') },
      }),
      getSnapshotLibrary: async () => ({ readIssueDetail: async () => ({ issue: issue }) }),
    })
    const unknown = await withLib(projection({})).handleIssueDetail({ number: 7, cwd: 'cwd' })
    check(unknown && unknown.ok === true && unknown.fromSnapshot === true, '库里命中时详情从库出（不发取数请求）')
    check(unknown.issue.isPullRequest === undefined && unknown.issue.mergedAt === undefined,
      '库里不知道时不写这两格（不知道 ≠ 不是 PR / 没合并过）')
    const known = await withLib(projection({
      row: Object.assign({}, projection({}).row, { isPullRequest: true }),
      groups: Object.assign({}, projection({}).groups, { mergeInfo: { completeness: 'complete', reason: null, lastQueriedMs: Date.now() } }),
    })).handleIssueDetail({ number: 7, cwd: 'cwd' })
    check(known.issue.isPullRequest === true, '库里记着是拉取请求就照实交')
    check(known.issue.mergedAt === null, '合并信息组确认过、没合并 → mergedAt 给 null（明确知道）')
  }
  if (fail) { console.log('\nRED #524 探针有失败（过 ' + pass + ' / 败 ' + fail + '）'); process.exit(1) }
  console.log('\nGREEN #524 探针全绿（' + pass + ' 项）')
}
main().catch((e: unknown) => { console.error('探针自身异常：', e); process.exit(1) })
