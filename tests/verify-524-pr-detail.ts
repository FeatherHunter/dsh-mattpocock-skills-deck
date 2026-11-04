// verify-524-pr-detail.ts —— #524 回归探针：拉取请求详情与普通工单详情走同一趟只读会话
// 历史：旧详情房只查普通工单，拉取请求页签点 #106 必红 notFound；后来补了「先工单、再拉取请求、最后 REST」。
// #1444 起详情改走 Tracker 只读会话的 get（房间内部自己先工单、再拉取请求，并在失败时退 REST）。
// #1870：旧的单票详情直取模块（issue-detail-fetch.ts）退役，这一条改成驱动生产里那条
// comment-thread-fetch.handleIssueDetail（本地快照库优先、库里没有才经会话 get），判据保持不变：
// 标记对不对、失败是否如实、以及这一路一次外部命令都不发。
//
// 拉取请求的 isPullRequest / mergedAt / reviews 三格现在由快照行与读投影负责（库里的行组带着它们），
// 详情回包本身只给详情页认的连接形状；这一条钉回包形状与失败口径，PR 标记那一半由快照行的门禁盯。
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
  }
  {
    const { h } = stub()
    const r = await h.handleIssueDetail({ number: 7, cwd: 'cwd' })
    check(r && r.ok === true && r.issue && r.issue.number === 7 && r.issue.state === 'OPEN', '普通工单号仍绿（会话 get 命中，不误标状态）')
    check(r && r.issue && r.issue.subIssues && Array.isArray(r.issue.subIssues.nodes), '子票连接照旧带（清单仍由快照/地图那条路提供）')
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
    check(typeof h.fetchIssueDetailREST === 'undefined', 'REST 直取口已删（房间内部已有降级，不再留第二条真源）')
  }
  if (fail) { console.log('\nRED #524 探针有失败（过 ' + pass + ' / 败 ' + fail + '）'); process.exit(1) }
  console.log('\nGREEN #524 探针全绿（' + pass + ' 项）')
}
main().catch((e: unknown) => { console.error('探针自身异常：', e); process.exit(1) })
