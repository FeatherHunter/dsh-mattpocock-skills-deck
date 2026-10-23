// verify-524-pr-detail.ts —— #524 回归探针：拉取请求详情与普通工单详情走同一趟只读会话
// 历史：旧详情房只查普通工单，拉取请求页签点 #106 必红 notFound；后来补了「先工单、再拉取请求、最后 REST」。
// #1444 起详情改走 Tracker 只读会话的 get（房间内部自己先工单、再拉取请求，并在失败时退 REST），
// 所以这一条盯三件事：标记对不对（isPullRequest / mergedAt / reviews）、失败是否如实、以及
// 本文件不再发任何 gh 命令（REST 兜底 fetchIssueDetailREST 已删除，不再从外面直取）。
// 只读内存桩：不调真实 gh，不读令牌，不记仓库地址原文；只覆盖详情房，不碰列表与快照与前端页签。
// 运行：node --import ./scripts/ts-hook.mts tests/verify-524-pr-detail.ts
import path from 'node:path'
import { pathToFileURL } from 'node:url'
let pass = 0
let fail = 0
const check = (ok: unknown, msg: string) => { if (!ok) { fail++; console.error('FAIL', msg) } else { pass++; console.log('PASS', msg) } }

async function main() {
  const ROOT = path.resolve(import.meta.dirname, '..')
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/refresh/rooms/host/issue-detail-fetch.js')).href)

  // 契约票（房间 get 回来的那一份）：评论与评审都用契约自己的字段名（评论 author 是 Actor，评审是 reviewer）。
  const contractIssue = (over: any) => Object.assign({
    key: '106', effortId: 'e', type: 'issue', title: '标题', state: 'closed', body: '正文',
    url: 'https://x/pull/106', createdAt: 'c', updatedAt: 'u', closedAt: 'd', parentKey: null,
    author: { login: 'a' }, labels: [], assignees: [],
    comments: [{ author: { login: 'c1' }, authorAssociation: 'MEMBER', body: '评论', createdAt: 'c1t', updatedAt: 'c1u' }],
    blockedBy: [], isPullRequest: true, mergedAt: null,
    reviews: [{ state: 'APPROVED', reviewer: { login: 'rv' }, submittedAt: 'rv-t' }],
  }, over)

  function stub(mode: string) {
    const calls: string[] = []
    const gets: any[] = []
    const depsCalls: any[] = []
    const runGh = async (args?: string[]) => { calls.push((args || []).join(' ')); return { ok: false, kind: 'env', error: '详情房不该再直调 gh' } }
    const session: any = {
      get: async (ref: any, key: any, opts: any, ctx: any) => {
        gets.push({ ref: ref, key: key, opts: opts, ctx: ctx })
        const n = Number(key)
        if (n === 999999) return { ok: false, error: { kind: 'notFound', message: '找不到 #' + n, raw: '' } }
        if (n === 106) return { ok: true, data: contractIssue({}) }
        return { ok: true, data: contractIssue({ key: String(n), number: n, title: '工单标题', state: 'open', url: 'https://x/issues/' + n, isPullRequest: false, mergedAt: null, reviews: [], comments: [] }) }
      },
      getDependencies: async (ref: any, key: any, opts: any, ctx: any) => {
        depsCalls.push({ ref: ref, key: key, opts: opts, ctx: ctx })
        return { ok: true, data: { blockedBy: [{ key: '7', title: '阻塞票', state: 'open' }], blocking: [] } }
      },
    }
    const h = mod.createIssueDetail({
      getRepoKey: async () => ({ owner: 'o', name: 'r' }),
      runGh: runGh,
      openSession: async (cwd: string) => ({ ok: true, backendId: 'github', call: (fn: any) => fn(session, { cwd: cwd, caller: 'refresh' }) }),
    })
    return { h, calls, gets, depsCalls }
  }

  {
    const { h, calls, gets, depsCalls } = stub('pr')
    const r = await h.fetchIssueDetail(106, 'cwd')
    check(r && r.ok === true && r.issue && r.issue.number === 106 && r.issue.isPullRequest === true, '拉取请求号变绿（会话 get 命中，号对且标为拉取请求）')
    check(r && r.issue && r.issue.state === 'CLOSED' && r.issue.reviews.length === 1 && r.issue.reviews[0].author.login === 'rv', '评审映射回详情页认的 author 字段（契约里叫 reviewer）')
    check(gets.length === 1 && gets[0].opts && gets[0].opts.comments && gets[0].opts.comments.first === 50, '评论只要一页 50 条（不扩契约：加载更多仍走 fetchIssueComments）')
    check(gets[0].ctx && gets[0].ctx.caller === 'refresh' && gets[0].ref.refId === 'o/r', '会话上下文带 caller=refresh，仓库坐标是 owner/name')
    check(depsCalls.length === 1, '阻塞边单独问一次 getDependencies（失败也只退化入边，不让详情崩）')
    check(r.issue.blockedBy.nodes.length === 1 && r.issue.blockedBy.nodes[0].number === 7 && r.issue.blockedBy.nodes[0].state === 'OPEN', '阻塞边回详情页认的 {nodes:[{number,title,state}]} 形状')
    check(r.issue.comments.pageInfo && r.issue.comments.pageInfo.hasNextPage === false, '评论连接仍带 pageInfo（界面按它决定有没有「加载更多」）')
    check(calls.length === 0, '这一趟一次 gh 都没发（实发 ' + calls.length + ' 条）')
  }
  {
    const { h } = stub('issue')
    const r = await h.fetchIssueDetail(7, 'cwd')
    check(r && r.ok === true && r.issue && r.issue.number === 7 && r.issue.isPullRequest === false, '普通工单号仍绿（房间 get 先工单命中，不误标拉取请求）')
    check(r && r.issue && r.issue.mergedAt === null && Array.isArray(r.issue.reviews) && r.issue.reviews.length === 0, '工单命中补空值（mergedAt 空＋reviews 空数组，与旧口径一致）')
  }
  {
    const { h, calls } = stub('bad')
    const r = await h.fetchIssueDetail(999999, 'cwd')
    check(r && r.ok === false && /notFound|404/.test(String((r.error && (r.error.kind || r.error.message)) || '')), '坏号仍诚实未找到（会话回 notFound，不误报成功）')
    check(calls.length === 0, '坏号也不退回直调 gh（旧 REST 探测已删，实发 ' + calls.length + ' 条）')
  }
  {
    const { h } = stub('hint')
    const r = await h.fetchIssueDetail(106, 'cwd', { isPullRequest: true })
    check(r && r.ok === true && r.issue && r.issue.isPullRequest === true, '快照提示是拉取请求时照样变绿（提示不再改变查询顺序，房间自己两路都问）')
  }
  {
    const h = mod.createIssueDetail({ getRepoKey: async () => ({ owner: 'o', name: 'r' }) })
    const r = await h.fetchIssueDetail(7, 'cwd')
    check(r && r.ok === false && r.error && r.error.kind === 'env', '没注入会话时如实回失败（不许假装成功）')
    check(typeof h.fetchIssueDetailREST === 'undefined', 'REST 直取口已删（房间内部已有降级，不再留第二条真源）')
  }
  if (fail) { console.log('\nRED #524 探针有失败（过 ' + pass + ' / 败 ' + fail + '）'); process.exit(1) }
  console.log('\nGREEN #524 探针全绿（' + pass + ' 项）')
}
main().catch((e: unknown) => { console.error('探针自身异常：', e); process.exit(1) })
