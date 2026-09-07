// verify-524-pr-detail.js — #524 回归探针：拉取请求详情走拉取请求查询兜底（只改详情房）
// 背景：旧详情房只查普通工单，拉取请求页签点 #106 必红 notFound；新后端单票查询已是先工单后拉取请求。
// 只读内存桩：不调真实 gh，不读令牌，不记仓库地址原文；只覆盖详情房，不碰列表与快照与前端页签。
// 调用预算：坏号全链最多4次（GraphQL2：普通工单1＋拉取请求1；REST2：/issues1＋/pulls1；每路各一次）。
// 快照提示错配多一次往返可接受（先按提示查，不中再走另一路）；限流走既有降级通道，不在本探针单测。
// 运行：node tests/verify-524-pr-detail.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
let pass = 0
let fail = 0
const check = (ok, msg) => { if (!ok) { fail++; console.error('FAIL', msg) } else { pass++; console.log('PASS', msg) } }
async function main() {
  const ROOT = path.resolve(__dirname, '..')
  const src = fs.readFileSync(path.join(ROOT, 'src/host/issueDetail.js'), 'utf8')
  const ct = fs.readFileSync(path.join(ROOT, 'src/host/commentThreads.js'), 'utf8')
  check(src.includes('pullRequest(number:'), '详情房含拉取请求 GraphQL 查询（pullRequest 按号查）')
  check(src.includes('/pulls/\' + n'), '详情房 REST 兜底含 /pulls 直取一次')
  check(src.includes('isPullRequest'), '详情房返回带是否为拉取请求标记（客户端只读判断用）')
  check(ct.includes('isPullRequest'), '评论线程把快照提示直通给详情房（只透传，不另查快照）')
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/host/issueDetail.js')).href)
  const prNode = { number: 106, title: '拉取请求标题', state: 'CLOSED', body: '正文', url: 'https://x/pull/106', updatedAt: 'u', createdAt: 'c', closedAt: 'd', mergedAt: null, author: { login: 'a' }, labels: { nodes: [] }, assignees: { nodes: [] }, comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, reviews: { nodes: [] } }
  const issueNode = { number: 7, title: '工单标题', state: 'OPEN', body: '正文', url: 'https://x/issues/7', updatedAt: 'u', createdAt: 'c', closedAt: null, author: { login: 'a' }, labels: { nodes: [] }, assignees: { nodes: [] }, comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, subIssues: { totalCount: 0, nodes: [] }, blockedBy: { nodes: [] }, blocking: { nodes: [] } }
  function stub(mode) {
    const calls = []
    const runGh = async (args) => {
      const j = (args || []).join(' ')
      calls.push(j)
      const isGql = j.includes('graphql')
      if (isGql && j.includes('pullRequest(number:')) {
        if (mode === 'pr' || mode === 'hint') return { ok: true, text: JSON.stringify({ data: { repository: { pullRequest: prNode } } }) }
        return { ok: true, text: JSON.stringify({ data: { repository: { pullRequest: null } } }) }
      }
      if (isGql) {
        if (mode === 'issue') return { ok: true, text: JSON.stringify({ data: { repository: { issue: issueNode } } }) }
        return { ok: true, text: JSON.stringify({ data: { repository: { issue: null } } }) }
      }
      if (j.includes('/pulls/106/reviews')) return { ok: true, text: '[]' }
      if (/\/pulls\/106(\s|$)/.test(j)) {
        if (mode === 'rest-pr' || mode === 'hint-miss') return { ok: true, text: JSON.stringify({ number: 106, title: '拉取请求标题', state: 'closed', body: '正文', html_url: 'https://x/pull/106', user: { login: 'a' }, labels: [], assignees: [], merged_at: null }) }
        return { ok: false, kind: 'notfound', error: '404 not found' }
      }
      if (/\/issues\/106(\s|$)/.test(j)) return { ok: false, kind: 'notfound', error: '404 not found' }
      if (/\/issues\/7(\s|$)/.test(j)) return { ok: true, text: JSON.stringify({ number: 7, title: '工单标题', state: 'open', body: '正文', html_url: 'https://x/issues/7', user: { login: 'a' }, labels: [], assignees: [] }) }
      if (j.includes('/comments')) return { ok: true, text: '[]' }
      if (j.includes('/sub_issues') || j.includes('/blocked_by')) return { ok: true, text: '[]' }
      if (/\/issues\/999999(\s|$)/.test(j) || /\/pulls\/999999(\s|$)/.test(j)) return { ok: false, kind: 'notfound', error: '404 not found' }
      return { ok: false, kind: 'notfound', error: '404 not found' }
    }
    const h = mod.createIssueDetail({ getRepoKey: async () => ({ owner: 'o', name: 'r' }), runGh, execProc: async () => ({ ok: false }), getTrackerRegistry: async () => null, getPlatform: async () => ({}), getDetectionService: async () => null, getRepoRoot: async () => '', ctx: {}, timer: {}, getGhPath: () => '', getGhLastError: () => '', fetchIssues: async () => ({ ok: true, issues: [] }), fetchMapsDetailREST: async () => ({ ok: true, issues: {} }), mapTicket: (x) => x, parseMapBody: () => ({}), computeLevels: () => ({}), groupTickets: () => ({}), isRateLimitError: () => false })
    return { h, calls }
  }
  { const { h } = stub('pr'); const r = await h.fetchIssueDetail(106, 'cwd')
    check(r && r.ok === true && r.issue && r.issue.number === 106 && r.issue.isPullRequest === true, '拉取请求号变绿（GraphQL 兜底命中，号对且标为拉取请求）') }
  { const { h } = stub('issue'); const r = await h.fetchIssueDetail(7, 'cwd')
    check(r && r.ok === true && r.issue && r.issue.number === 7 && r.issue.isPullRequest === false, '普通工单号仍绿（先查工单命中，不误标拉取请求）')
    check(r && r.issue && r.issue.mergedAt === null && Array.isArray(r.issue.reviews) && r.issue.reviews.length === 0, '工单命中补空值（mergedAt空＋reviews空数组，与REST一致）') }
  { const { h, calls } = stub('bad'); const r = await h.fetchIssueDetail(999999, 'cwd')
    check(r && r.ok === false && /notFound|404/.test(String((r.error && (r.error.kind || r.error.message)) || '')), '坏号仍诚实未找到（两路都不中，不误报成功）')
    const gql = calls.filter((c) => c.includes('graphql')).length
    const rest = calls.filter((c) => !c.includes('graphql')).length
    check(gql <= 2 && rest <= 2, '坏号调用预算每路各一次（实测 GraphQL' + gql + ' REST' + rest + '，每路≤2次）') }
  { const { h, calls } = stub('rest-pr'); const r = await h.fetchIssueDetailREST(106, 'cwd')
    check(r && r.ok === true && r.issue && r.issue.number === 106 && r.issue.isPullRequest === true && r.fallback === 'rest-pr', 'REST 兜底直取拉取请求一次并补标记（/issues 不中转 /pulls）')
    check(calls.some((c) => c.includes('/pulls/106')), 'REST 兜底确实调了 /pulls（每路各一次，不多查）') }
  { const { h, calls } = stub('hint'); const r = await h.fetchIssueDetail(106, 'cwd', { isPullRequest: true })
    const firstGql = calls.find((c) => c.includes('graphql'))
    check(r && r.ok === true && r.issue && r.issue.isPullRequest === true, '快照提示直通：标为拉取请求时详情变绿')
    check(!!firstGql && firstGql.includes('pullRequest(number:'), '快照提示直通：先查拉取请求查询（省一次往返）') }
  if (fail) { console.log('\nRED #524 探针有失败（过 ' + pass + ' / 败 ' + fail + '）'); process.exit(1) }
  console.log('\nGREEN #524 探针全绿（' + pass + ' 项）')
}
main().catch((e) => { console.error('探针自身异常：', e); process.exit(1) })
