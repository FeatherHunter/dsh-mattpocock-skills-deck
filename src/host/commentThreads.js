// src/host/commentThreads.js —— 单票详情与评论读写及增量探针（H5 #449 从 host/index.js 389–670 搬出电话体，纯结构、行为零变化）。
// 以后谁改它：改单票详情字段、评论分页读写或增量探针的人。预估约300行，超 350 打回。
// 接线：由 index.js 动态 import 加载；normCwd 与单票分发前奏经 index 转供给复用（H4 同例），不各留一份拷贝；本文件不引用其他新文件。
export function createCommentThreads(deps) {
  const { normCwd, canonicalKey, selectEarly, isComposerSelection, getTrackerRegistry, getPlatform, ctx, timer, DEFAULT_CWD, errText, isRateLimitError, getRepoKey, runGh, execProc, fetchIssueDetail, fetchIssueIndex, issueIndexFromSnapshot, issueIndexChanged, rememberIssueIndex, getCache, setCache, lastIssueIndexByRepo, lastProbeAtByRepo, logCtx } = deps
  // T5 #10 · 评论分页（反向分页 cursor，节流由 client 侧 600ms 控制；单页 50，失败重试与 3 次兜底）
  async function fetchIssueCommentsREST(n, after, cwd) {
    const repo = await getRepoKey(cwd)
    if (!repo) return { ok: false, error: { kind: 'env', message: '无法解析 owner/repo' } }
    try {
      // REST 分页：after 为已加载数（如 "50"），page = floor(after/50)+1；GraphQL cursor 场景下退化为 page 2 起
      let page = 1
      if (after) {
        const num = Number(after)
        if (!isNaN(num) && num >= 0) page = Math.floor(num / 50) + 2
        else page = 2
      } else {
        page = 1
      }
      const r = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n + '/comments?per_page=50&page=' + page], cwd)
      if (!r.ok) {
        if (r.kind === 'notfound' || /404/i.test(String(r.error||''))) return { ok: false, error: { kind: '404', message: String(r.error||'not found') } }
        if (isRateLimitError(r)) return { ok: false, error: { kind: 'rateLimit', message: String(r.error||'rate limit') } }
        return { ok: false, error: { kind: r.kind || 'network', message: String(r.error||'request failed') } }
      }
      const arr = JSON.parse(r.text) || []
      const nodes = arr.map(function (c) { return { author: { login: (c.user && c.user.login) || '' }, authorAssociation: c.author_association || '', body: c.body || '', createdAt: c.created_at, updatedAt: c.updated_at } })
      const hasNext = nodes.length === 50
      const endCursor = String((Number(after||0) + nodes.length))
      return { ok: true, nodes: nodes, pageInfo: { hasNextPage: hasNext, endCursor: endCursor }, fallback: 'rest' }
    } catch (e) { return { ok: false, error: { kind: 'parse', message: String(e) } } }
  }
  async function fetchIssueComments(n, after, cwd) {
    const repo = await getRepoKey(cwd)
    if (!repo) return { ok: false, error: { kind: 'env', message: '无法解析 owner/repo' } }
    if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
    // GraphQL 优先（cursor 分页）
    const query = 'query($owner:String!,$name:String!,$n:Int!,$after:String){repository(owner:$owner,name:$name){issue(number:$n){comments(first:50, after:$after){nodes{author{login} authorAssociation body createdAt updatedAt} pageInfo{hasNextPage endCursor}}}}}'
    // after 为 null 时传空字符串，GraphQL 会视为空 cursor（首段）；需传递变量 after 否则报错，故用 -F after= 值，空则首段
    const afterVal = after || null
    for (let attempt = 0; attempt < 2; attempt++) {
      const args = ['api', 'graphql', '-f', 'query=' + query, '-F', 'owner=' + repo.owner, '-F', 'name=' + repo.name, '-F', 'n=' + n]
      if (afterVal) args.push('-F', 'after=' + afterVal)
      else args.push('-F', 'after=')
      const r = await runGh(args, cwd)
      if (!r.ok) {
        if (isRateLimitError(r)) { try { if (logCtx) logCtx.fire('warn', 'graphql.fallback', { scope: '单票', reason: 'rate-limit' }) } catch (eL) {}; return fetchIssueCommentsREST(n, after, cwd) }
        if (r.kind === 'notfound' || /not found|could not resolve/i.test(String(r.error||''))) return { ok: false, error: { kind: 'notFound', message: String(r.error||'not found') } }
        if (r.kind !== 'network') return { ok: false, error: { kind: r.kind || 'network', message: String(r.error||'network') } }
        continue
      }
      try {
        const j = JSON.parse(r.text)
        if (j.errors) {
          if (isRateLimitError({ error: JSON.stringify(j.errors) })) { try { if (logCtx) logCtx.fire('warn', 'graphql.fallback', { scope: '单票', reason: 'rate-limit' }) } catch (eL) {}; return fetchIssueCommentsREST(n, after, cwd) }
          if (/not found|could not resolve/i.test(JSON.stringify(j.errors))) return { ok: false, error: { kind: 'notFound', message: JSON.stringify(j.errors).slice(0,300) } }
          return { ok: false, error: { kind: 'graphql', message: JSON.stringify(j.errors).slice(0,300) } }
        }
        const com = j.data && j.data.repository && j.data.repository.issue && j.data.repository.issue.comments
        if (!com) return { ok: false, error: { kind: 'notFound', message: 'issue not found' } }
        return { ok: true, nodes: com.nodes || [], pageInfo: com.pageInfo || { hasNextPage: false, endCursor: null } }
      } catch (e) { return { ok: false, error: { kind: 'parse', message: String(e) } } }
    }
    return { ok: false, error: { kind: 'network', message: 'GraphQL 评论分页请求失败（重试后仍失败）' } }
  }
  async function handleIssueDetail(args) {
    const n = args && args.number
    const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
    if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
    try {
      // 第一性原理分发：经 index 从会话启停模块转供给共享判据（H4 同例），不各留一份拷贝。
      const _sel = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
      const useTracker = isComposerSelection(_sel)
      if (useTracker) {
        const reg = await getTrackerRegistry()
        const backendId = _sel.backendId
        const tracker = reg.get(backendId)
        if (!tracker || typeof tracker.get !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + backendId + "' 未实现 get" } }
        let repoRef = null
        try { repoRef = reg.describe({ cwd }, backendId) } catch {}
        if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
        const opCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
        const key = String(n).padStart(2, '0')
        const r = await tracker.get(repoRef, key, {}, opCtx)
        if (!r || !r.ok) return r
        // 统一为 fetchIssueDetail 的返回形状（{ok, issue}），便于客户端复用
        const iss = r.data
        // 适配客户端期望的 issue 形状：补充 number / labels 节点等
        if (iss && iss.key != null && iss.number == null) {
          const nn = parseInt(iss.key, 10)
          if (!isNaN(nn)) iss.number = nn
        }
        // 将 key 归一为字符串
        if (iss && iss.key != null) iss.key = String(iss.key)
        // 详情需要包含 comments / blockedBy 等，markdown 的 get 已包含
        return { ok: true, issue: {
          number: iss.number != null ? iss.number : (iss.key ? parseInt(iss.key,10) : n),
          title: iss.title || '',
          state: iss.state === 'closed' ? 'CLOSED' : 'OPEN',
          body: iss.body || '',
          url: iss.url || '',
          updatedAt: iss.updatedAt || '',
          createdAt: iss.createdAt || '',
          closedAt: iss.closedAt || null,
          author: iss.author,
          labels: { nodes: (iss.labels || []).map(function(l){ return { name: l.name, color: l.color || '' } }) },
          assignees: { nodes: (iss.assignees || []).map(function(a){ return typeof a === 'string' ? { login: a } : a }) },
          comments: iss.comments || { nodes: [] },
          subIssues: iss.subIssues || { totalCount: 0, nodes: [] },
          blockedBy: { nodes: (iss.blockedBy || []).map(function(b){ if (typeof b === 'number') return { number: b }; if (b && b.key != null) { const nn = parseInt(b.key,10); return { number: isNaN(nn) ? b.key : nn, title: b.title||'', state: b.state==='closed'?'CLOSED':'OPEN' }; } return b; }) },
          blocking: { nodes: [] },
        } }
      }
      const r = await fetchIssueDetail(Number(n), cwd)
      return r
    } catch (e) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
  }
  async function handleIssueComments(args) {
    const n = args && args.number
    const after = args && args.after
    const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
    if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
    try {
      // 第一性原理分发：经 index 从会话启停模块转供给共享判据（H4 同例），不各留一份拷贝。
      const _sel = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
      const useTracker = isComposerSelection(_sel)
      if (useTracker) {
        const reg = await getTrackerRegistry()
        const backendId = _sel.backendId
        const tracker = reg.get(backendId)
        if (!tracker || typeof tracker.get !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + backendId + "' 未实现 get" } }
        let repoRef = null
        try { repoRef = reg.describe({ cwd }, backendId) } catch {}
        if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
        const opCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
        const key = String(n).padStart(2, '0')
        const r = await tracker.get(repoRef, key, {}, opCtx)
        if (!r || !r.ok) return r
        const iss = r.data
        const nodes = (iss.comments || []).map(function(c){ return { author: c.author || { login: '' }, authorAssociation: c.authorAssociation || '', body: c.body || '', createdAt: c.createdAt || '', updatedAt: c.updatedAt || '' } })
        // 简单分页：after 为已加载数
        const afterNum = after != null ? Number(after) : 0
        const start = isNaN(afterNum) ? 0 : afterNum
        const pageNodes = nodes.slice(start, start + 50)
        const hasNext = start + 50 < nodes.length
        return { ok: true, nodes: pageNodes, pageInfo: { hasNextPage: hasNext, endCursor: String(start + pageNodes.length) } }
      }
      const r = await fetchIssueComments(Number(n), after != null ? String(after) : null, cwd)
      return r
    } catch (e) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
  }
  // #255 · IssueDetail 评论输入区（GitHub 单点 · MISSING 零分支）· 宿主透传 = 本次唯一宿主改动。
  // 第一性原理：能力 = 运行时事实（G5 调用即知，无能力表）；路径 = registry.select → tracker.comment（契约第 8 号 op），
  // 预检不进入评论链（去耦合：评论路径与预检仅共享错误分类常量）。成功即失效面板快照缓存（#213 白名单同语义），
  // 推进只来自重求值（client 击穿详情缓存重取 + probe 增量确认），无乐观插入。错误直透 TrackerError{kind,message}。
  async function handleCommentIssue(args) {
    const n = args && args.number
    const body = args && args.body
    const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
    if (!n || isNaN(Number(n))) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
    if (typeof body !== 'string' || !body.trim()) return { ok: false, error: { kind: 'parse', message: '评论内容为空' } }
    try {
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: { kind: 'env', message: 'registry unavailable' } }
      const handle = { cwd: cwd }
      const opCtx = { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), timers: { setTimeout: (fn,ms)=>timer.timeout(fn,ms), clearTimeout: (id)=>{try{clearTimeout(id)}catch{}} }, exec: async function(cmd, cargs, opts){ const argv=[String(cmd)].concat(cargs||[]); const c=(opts&&opts.cwd)||cwd; const r=await execProc(argv, c); if(!r.ok) throw new Error(r.error||String(r.code||'exec failed')); return { stdout:r.text, text:r.text, ok:true, code:r.code } } }
      let sel = null
      try { sel = await reg.select(handle, opCtx) } catch (eSel) {}
      if (!sel || !sel.backendId) return { ok: false, error: { kind: 'unsupported', message: '未选择可用 tracker 后端，无法评论' } }
      let repoRef = null
      try { repoRef = reg.describe({ cwd: cwd }, sel.backendId) } catch (eDesc) {}
      if (repoRef && !repoRef.refId && sel.backendId === 'github') {
        // refId 补全（host 编排职责，与 buildSnapshot 同语义：git remote → .git/config → gh repo view 三级解析）
        try {
          const rk = await getRepoKey(cwd)
          if (rk && rk.owner && rk.name) { repoRef.refId = rk.owner + '/' + rk.name; repoRef.name = repoRef.refId; repoRef.url = 'https://github.com/' + repoRef.refId }
        } catch (eRk) {}
      }
      if (!repoRef || !repoRef.refId) return { ok: false, error: { kind: 'not-found', message: '无法解析目标仓库（refId missing）' } }
      const tracker = reg.get(sel.backendId)
      if (!tracker || typeof tracker.comment !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + sel.backendId + "' 未实现 comment" } }
      const r = await tracker.comment(repoRef, String(Number(n)), String(body), opCtx)
      if (r && r.ok) {
        // 写操作成功 → 失效面板快照缓存（#213 同语义；右侧列表增量由 client 静默重取快照经差异产出）
        try { setCache({ ts: 0, snapshot: null, error: null, cwd: cwd }) } catch {}
      }
      return r
    } catch (e) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
  }
  // v1.5 R2（#2 MVP）：probe 改用 `since` 时间戳探测全 issue 增量（地图 + 子票 + 其他），
  //   1 次 REST 调用覆盖全仓库变化。原实现 `labels=wayfinder:map` 仅匹配地图本身，
  //   **漏检所有子票变化**——面板可接/阻塞/已认领/已关闭分组（DESIGN.md §5.2）都是子票，
  //   故"列表不更新状态"。since 语义：返回数组非空 = 自上次快照以来有变化 → 视为 changed。
  //   配额仍走 REST 5000/h 池（独立于 GraphQL 5000 点/h），不烧穿。
  async function handleProbe(args) {
    const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
    // 第一性原理分发：经 index 从会话启停模块转供给共享判据（H4 同例），不各留一份拷贝。
    // markdown 等走轻量 list 探针，github 仍走 gh issue index
    const _selProbe = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
    const useProbeTracker = isComposerSelection(_selProbe)
    if (useProbeTracker) {
      try {
        const reg = await getTrackerRegistry()
        const tracker = reg.get(_selProbe.backendId)
        if (tracker && typeof tracker.list === 'function') {
          let repoRef = null
          try { repoRef = reg.describe({ cwd }, _selProbe.backendId) } catch {}
          if (!repoRef) repoRef = { backend: _selProbe.backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || _selProbe.backendId, url: '' }
          const opCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
          const r = await tracker.list(repoRef, {}, opCtx)
          if (!r || !r.ok) return { ok: false, error: errText((r && r.error) || 'probe list 失败') }
          const all = Array.isArray(r.data) ? r.data : []
          // 轻量索引：key -> state
          const idx = {}
          all.forEach(function(it){ const k = it && (it.key != null ? String(it.key).padStart(2,'0') : (it.number != null ? String(it.number).padStart(2,'0') : '')); if(k) idx[k] = String(it.state||'OPEN').toUpperCase() })
          const rk1 = _selProbe.backendId + ':' + cwd
          const known = lastIssueIndexByRepo[rk1] || {}
          const changed = issueIndexChanged(known, idx)
          rememberIssueIndex({ owner: _selProbe.backendId, name: cwd }, idx)
          // 兼容 remember 的 repoKey 形态：用 backendId+cwd 作 key，避免与 github 的 owner/name 串
          lastIssueIndexByRepo[rk1] = idx
          lastProbeAtByRepo[rk1] = new Date().toISOString()
          if (changed) setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
          return { ok: true, changed: changed, repo: { owner: _selProbe.backendId, name: String(cwd).split(/[\\/]/).pop()||'' }, count: all.length, since: lastProbeAtByRepo[rk1] }
        }
      } catch (e) { return { ok: false, error: errText(e) } }
    }
    try {
      const remote = await fetchIssueIndex(cwd)
      if (!remote.ok) return { ok: false, error: errText(remote.error || 'probe 失败') }
      const repo = remote.repo
      const rk1 = repo.owner + '/' + repo.name
      const known = lastIssueIndexByRepo[rk1] || issueIndexFromSnapshot(getCache().snapshot)
      const changed = issueIndexChanged(known, remote.index)
      rememberIssueIndex(repo, remote.index)
      lastProbeAtByRepo[rk1] = new Date().toISOString()
      if (changed) setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
      return { ok: true, changed: changed, repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
    } catch (e) { return { ok: false, error: errText(e) } }
  }
  return { fetchIssueCommentsREST, fetchIssueComments, handleIssueDetail, handleIssueComments, handleCommentIssue, handleProbe }
}
