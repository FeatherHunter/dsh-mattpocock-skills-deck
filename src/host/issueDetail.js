// src/host/issueDetail.js —— 单详情与快照拼装（H2 #446 从 host/index.js 546–840 搬出，纯结构、行为零变化）。
// 以后谁改它：改详情查询字段（GraphQL/REST 双通道）或快照拼装结构的人。预估约 330 行，超 350 打回。
// 接线：由 index.js 动态 import 加载；执行器/注册表/解析函数等 18 项依赖全显式注入；本文件不引用其他新文件。
import { pullStateOf } from './tracker/backends/github/normalize.js'

export function createIssueDetail(deps) {
  const { getRepoKey, runGh, execProc, getTrackerRegistry, getPlatform, getDetectionService } = deps
  const { getRepoRoot, ctx, timer, getGhPath, getGhLastError } = deps
  const { isRateLimitError } = deps
    // T2 #7 · fetchIssueDetail 单 issue 数据通路（复用 fetchMapsDetail 思路，独立别名/单 issue 不合并 aliases）
    // GraphQL 字段按 T2 契约：number title state body url updatedAt createdAt closedAt labels(first:20){nodes{name color}} assignees(first:10){nodes{login}} comments(first:50){nodes{author{login} authorAssociation body createdAt updatedAt}} subIssues(first:50){totalCount nodes{number title state}} blockedBy(first:20){nodes{number title state}}
    // 配额止血：GraphQL 按复杂度计点失败 → RATE_LIMIT 鉴别后切 REST 兜底；REST 逐请求失败置空，整体不崩
    // 错误形状与 fetchMapsDetail 对齐 {ok,error,issue?}；kind 细化 env|parse|graphql|network|rateLimit|notFound|404
    async function fetchIssueDetailREST(n, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', message: '无法解析 owner/repo（git remote 或 gh repo view 失败）' } }
      try {
        // 先查普通工单，404 再查拉取请求一次（与新后端单票查询同分支：/issues 不中试 /pulls；两次都不中才是真的未找到）
        let issue = null
        let fromPR = false
        const r = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n], cwd)
        if (r.ok) { issue = JSON.parse(r.text) }
        else if (r.kind === 'notfound' || /404|not found/i.test(String(r.error||''))) {
          const pr = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/pulls/' + n], cwd)
          if (!pr.ok) {
            if (pr.kind === 'notfound' || /404/i.test(String(pr.error||''))) return { ok: false, error: { kind: '404', message: String(pr.error||'not found') } }
            return { ok: false, error: { kind: 'notFound', message: String(pr.error||'not found') } }
          }
          const pj = JSON.parse(pr.text)
          if (!pj || pj.number == null) return { ok: false, error: { kind: 'notFound', message: 'pull not found' } }
          issue = pj
          fromPR = true
        }
        else {
          if (isRateLimitError(r)) return { ok: false, error: { kind: 'rateLimit', message: String(r.error||'rate limit') } }
          return { ok: false, error: { kind: r.kind || 'network', message: String(r.error||'request failed') } }
        }
        if (!issue || issue.number == null) return { ok: false, error: { kind: 'notFound', message: 'issue not found' } }
        const isPR = fromPR || (issue && issue.pull_request != null)
        // 拉取请求补合并时间与评审（与新后端单票富化同口径：失败保持空值，不阻塞详情显示）
        let mergedAt = (typeof issue.merged_at === 'string') ? issue.merged_at : null
        let reviews = []
        if (isPR) {
          try {
            if (!fromPR && mergedAt == null) { const mr = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/pulls/' + n], cwd); if (mr.ok) { const mj = JSON.parse(mr.text); if (mj && typeof mj.merged_at === 'string') mergedAt = mj.merged_at } }
            const vr = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/pulls/' + n + '/reviews?per_page=100'], cwd)
            if (vr.ok) { const arr = JSON.parse(vr.text) || []; reviews = arr.filter(function (x) { return x && typeof x.state === 'string' && x.state !== '' }).map(function (x) { return { state: x.state, author: { login: ((x.user && x.user.login) || '') }, submittedAt: (x.submitted_at || '') } }) }
          } catch (e) {}
        }
        let comments = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
        let subIssues = { totalCount: 0, nodes: [] }
        let blockedBy = { nodes: [] }
        try {
          const cr = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n + '/comments?per_page=50'], cwd)
          if (cr.ok) {
            const arr = JSON.parse(cr.text) || []
            comments.nodes = arr.map(function (c) { return { author: { login: (c.user && c.user.login) || '' }, authorAssociation: c.author_association || '', body: c.body || '', createdAt: c.created_at, updatedAt: c.updated_at } })
            comments.pageInfo = { hasNextPage: arr.length === 50, endCursor: String(arr.length) }
          }
        } catch (e) {}
        try {
          const sr = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n + '/sub_issues?per_page=50'], cwd)
          if (sr.ok) {
            const arr = JSON.parse(sr.text) || []
            subIssues.totalCount = arr.length
            subIssues.nodes = arr.map(function (s) { return { number: s.number, title: s.title, state: (String(s.state).toLowerCase()==='closed' ? 'CLOSED' : 'OPEN') } })
          }
        } catch (e) {}
        try {
          const br = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n + '/dependencies/blocked_by'], cwd)
          if (br.ok) {
            const arr = JSON.parse(br.text) || []
            blockedBy.nodes = arr.map(function (b) { return { number: b.number != null ? b.number : b.id, title: b.title || '', state: (String(b.state).toLowerCase()==='closed' ? 'CLOSED' : 'OPEN') } })
          }
        } catch (e) {}
        const mapped = {
          number: issue.number, title: issue.title, state: pullStateOf(issue),
          body: issue.body || '', url: issue.html_url || ('https://github.com/' + repo.owner + '/' + repo.name + (isPR ? '/pull/' : '/issues/') + n),
          updatedAt: issue.updated_at, createdAt: issue.created_at, closedAt: issue.closed_at,
          author: (issue.user && issue.user.login) ? { login: issue.user.login, name: (issue.user.name || ''), avatarUrl: (issue.user.avatar_url || '') } : undefined,
          labels: { nodes: (issue.labels || []).map(function (l) { return { name: l.name, color: l.color || '' } }) },
          assignees: { nodes: (issue.assignees || []).map(function (a) { return { login: a.login } }) },
          comments: comments,
          subIssues: subIssues,
          blockedBy: blockedBy,
          blocking: { nodes: [] },
          isPullRequest: isPR, mergedAt: mergedAt, reviews: reviews
        }
        return { ok: true, issue: mapped, fallback: fromPR ? 'rest-pr' : 'rest' }
      } catch (e) { return { ok: false, error: { kind: 'parse', message: String(e) } } }
    }

    async function fetchIssueDetail(n, cwd, opts) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', message: '无法解析 owner/repo（git remote 或 gh repo view 失败）' } }
      if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
      const frag = 'number title state body url updatedAt createdAt closedAt author{login avatarUrl ... on User{name} ... on Organization{name}} labels(first:20){nodes{name color}} assignees(first:10){nodes{login}} comments(first:50){nodes{author{login} authorAssociation body createdAt updatedAt} pageInfo{hasNextPage endCursor}} subIssues(first:50){totalCount nodes{number title state}} blockedBy(first:20){nodes{number title state}} blocking(first:20){nodes{number title state}}'
      // 拉取请求与新后端单票查询同分支：快照已标是拉取请求则先查拉取请求，否则先查普通工单再查拉取请求；两边都不中才走 REST（REST 内再试 /pulls 一次）
      const prFrag = 'number title state body url updatedAt createdAt closedAt mergedAt author{login avatarUrl ... on User{name} ... on Organization{name}} labels(first:20){nodes{name color}} assignees(first:10){nodes{login}} comments(first:50){nodes{author{login} authorAssociation body createdAt updatedAt} pageInfo{hasNextPage endCursor}} reviews(first:20){nodes{state author{login} submittedAt}}'
      async function queryPR() {
        try {
          const q = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequest(number:' + n + '){' + prFrag + '}}}'
          const p = await runGh(['api', 'graphql', '-f', 'query=' + q, '-F', 'owner=' + repo.owner, '-F', 'name=' + repo.name], cwd)
          if (!p.ok) { if (isRateLimitError(p)) return { rateLimit: true }; return { miss: true } }
          const j = JSON.parse(p.text)
          if (j.errors) { if (isRateLimitError({ error: JSON.stringify(j.errors) })) return { rateLimit: true }; return { miss: true } }
          const pr = j.data && j.data.repository && j.data.repository.pullRequest
          if (!pr) return { miss: true }
          pr.isPullRequest = true; pr.subIssues = { totalCount: 0, nodes: [] }; pr.blockedBy = { nodes: [] }; pr.blocking = { nodes: [] }
          // #599：已合并的拉取请求在 GitHub 那边 state=MERGED，这里收成契约的已关闭（与列表同一条规则）
          pr.state = pullStateOf(pr)
          return { found: true, issue: pr }
        } catch (e) { return { miss: true } }
      }
      if (opts && opts.isPullRequest === true) { const p0 = await queryPR(); if (p0.found) return { ok: true, issue: p0.issue }; if (p0.rateLimit) return fetchIssueDetailREST(n, cwd) }
      const query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){issue(number:' + n + '){' + frag + '}}}'
      let last = null
      let issueMiss = false
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await runGh(['api', 'graphql', '-f', 'query=' + query, '-F', 'owner=' + repo.owner, '-F', 'name=' + repo.name], cwd)
        if (!r.ok) {
          last = r
          if (isRateLimitError(r)) return fetchIssueDetailREST(n, cwd)
          if (r.kind === 'notfound' || /not found|could not resolve/i.test(String(r.error||''))) { issueMiss = true; break }
          if (r.kind !== 'network') return { ok: false, error: { kind: r.kind || 'network', message: String(r.error||'network') } }
          continue
        }
        try {
          const j = JSON.parse(r.text)
          if (j.errors) {
            if (isRateLimitError({ error: JSON.stringify(j.errors) })) return fetchIssueDetailREST(n, cwd)
            if (/not found|could not resolve/i.test(JSON.stringify(j.errors))) { issueMiss = true; break }
            return { ok: false, error: { kind: 'graphql', message: JSON.stringify(j.errors).slice(0,300) } }
          }
          const issue = j.data && j.data.repository && j.data.repository.issue
          if (!issue) { issueMiss = true; break }
          issue.isPullRequest = false; issue.mergedAt = null; issue.reviews = [] // 工单空值与REST对齐，消快照抖
          return { ok: true, issue: issue }
        } catch (e) { return { ok: false, error: { kind: 'parse', message: String(e) } } }
      }
      if (!(opts && opts.isPullRequest === true)) { const p1 = await queryPR(); if (p1.found) return { ok: true, issue: p1.issue }; if (p1.rateLimit) return fetchIssueDetailREST(n, cwd) }
      if (issueMiss) return fetchIssueDetailREST(n, cwd)
      return { ok: false, error: last || { kind: 'network', message: 'GraphQL 单 issue 请求失败（重试后仍失败）' } }
    }

  return { fetchIssueDetailREST, fetchIssueDetail }
}
