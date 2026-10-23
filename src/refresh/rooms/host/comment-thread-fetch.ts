/**
 * src/refresh/rooms/host/comment-thread-fetch.ts —— 单票详情与评论读写及增量探针（来源：src/refresh/rooms/host/comment-thread-fetch.js，H5 #449 从 host/index.js 389–670 搬出电话体，纯结构、行为零变化；本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：单票详情、评论分页读写与面板增量探针原来都挤在宿主入口里，搬到这里之后调用点只按名取，
 * 详情字段、分页策略与探针水印各自改各自的，不互相绊倒。
 *
 * 三条不能改的约定（改之前先看原来文件头那三行与调用点 index.js）：
 * 1. 由 index.js 动态引用加载，normCwd 与单票分发前奏经 index 转供给复用（H4 同例），不各留一份拷贝；本文件只引用原来那两个模块，不新增引用。
 * 2. 评论分页是 GraphQL 优先、失败退回 REST，退回条件（限流、分页失败）与原来完全一致，改了任何一条都会让面板在弱网下丢评论。
 * 3. 探针水印只在变化真的并进列表之后才推进（commitIssueIndex），没并进去时一个字节都不动，否则那条变化会被挤出下一次的扫描窗口，此后再也发现不了。
 */
import { idOfParts } from '../../../tracker/kernel/identity-keys.js'
// #1115：opCtx 上那个计时器口的唯一实现（撤销真句柄的三档判据见该文件头）。
import { hostTimers } from '../../contract/host-timer-ports.js'

// ---------------------------------------------------------------------------
// 类型（本次转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖全是函数与服务（目录归一、后端选择、注册表、平台、执行口、索引与缓存等），
// 形状按本文件实际用到的成员写成最小，全部用 any 接住；详情、评论、探针的回包都沿用原来的运行时形状，
// 类型只描述不约束，运行时行为一字不变。
// ---------------------------------------------------------------------------

/** 组装函数收到的依赖：目录归一、后端选择、注册表、执行口、索引与缓存等，全由调用点显式传入。 */
interface CommentThreadsDeps {
  normCwd: any
  canonicalKey: any
  selectEarly: any
  isComposerSelection: any
  getTrackerRegistry: any
  getPlatform: any
  ctx: any
  timer: any
  DEFAULT_CWD: any
  errText: any
  isRateLimitError: any
  getRepoKey: any
  runGh: any
  execProc: any
  fetchIssueDetail: any
  fetchIssueIndex: any
  fetchIssueIndexWindowed: any
  commitIssueIndex: any
  deltaRefresh: any
  issueIndexFromSnapshot: any
  issueIndexChanged: any
  rememberIssueIndex: any
  getCache: any
  setCache: any
  lastIssueIndexByRepo: any
  lastProbeAtByRepo: any
  logCtx: any
}

/**
 * 组装单票详情、评论读写与增量探针电话（依赖全显式传入）。
 *
 * 为什么：六个电话共享同一套前奏（空目录闸、分发判据、仓库键），收在一个组装函数里只是为了与原来 index.js 的电话体一一对应。
 * 什么约定不能改：返回对象的六个字段名是调用点按名取的，改名调用点就拿不到。
 */
export function createCommentThreads(deps: CommentThreadsDeps): any {
  const { normCwd, canonicalKey, selectEarly, isComposerSelection, getTrackerRegistry, getPlatform, ctx, timer, DEFAULT_CWD, errText, isRateLimitError, getRepoKey, runGh, execProc, fetchIssueDetail, fetchIssueIndex, fetchIssueIndexWindowed, commitIssueIndex, deltaRefresh, issueIndexFromSnapshot, issueIndexChanged, rememberIssueIndex, getCache, setCache, lastIssueIndexByRepo, lastProbeAtByRepo, logCtx } = deps as any
  // T5 #10 · 评论分页（反向分页 cursor，节流由 client 侧 600ms 控制；单页 50，失败重试与 3 次兜底）
  async function fetchIssueCommentsREST(n: any, after: any, cwd: any): Promise<any> {
    const repo: any = await getRepoKey(cwd)
    if (!repo) return { ok: false, error: { kind: 'env', message: '无法解析 owner/repo' } }
    try {
      // REST 分页：after 为已加载数（如 "50"），page = floor(after/50)+1；GraphQL cursor 场景下退化为 page 2 起
      let page: number = 1
      if (after) {
        const num: number = Number(after)
        if (!isNaN(num) && num >= 0) page = Math.floor(num / 50) + 2
        else page = 2
      } else {
        page = 1
      }
      const r: any = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n + '/comments?per_page=50&page=' + page], cwd)
      if (!r.ok) {
        if (r.kind === 'notfound' || /404/i.test(String(r.error||''))) return { ok: false, error: { kind: '404', message: String(r.error||'not found') } }
        if (isRateLimitError(r)) return { ok: false, error: { kind: 'rateLimit', message: String(r.error||'rate limit') } }
        return { ok: false, error: { kind: r.kind || 'network', message: String(r.error||'request failed') } }
      }
      const arr: any = JSON.parse(r.text) || []
      const nodes: any = arr.map(function (c: any) { return { author: { login: (c.user && c.user.login) || '' }, authorAssociation: c.author_association || '', body: c.body || '', createdAt: c.created_at, updatedAt: c.updated_at } })
      const hasNext: boolean = nodes.length === 50
      const endCursor: string = String((Number(after||0) + nodes.length))
      return { ok: true, nodes: nodes, pageInfo: { hasNextPage: hasNext, endCursor: endCursor }, fallback: 'rest' }
    } catch (e: any) { return { ok: false, error: { kind: 'parse', message: String(e) } } }
  }
  async function fetchIssueComments(n: any, after: any, cwd: any): Promise<any> {
    const repo: any = await getRepoKey(cwd)
    if (!repo) return { ok: false, error: { kind: 'env', message: '无法解析 owner/repo' } }
    if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
    // GraphQL 优先（cursor 分页）
    const query: string = 'query($owner:String!,$name:String!,$n:Int!,$after:String){repository(owner:$owner,name:$name){issue(number:$n){comments(first:50, after:$after){nodes{author{login} authorAssociation body createdAt updatedAt} pageInfo{hasNextPage endCursor}}}}}'
    // after 为 null 时传空字符串，GraphQL 会视为空 cursor（首段）；需传递变量 after 否则报错，故用 -F after= 值，空则首段
    const afterVal: any = after || null
    for (let attempt: number = 0; attempt < 2; attempt++) {
      const args: string[] = ['api', 'graphql', '-f', 'query=' + query, '-F', 'owner=' + repo.owner, '-F', 'name=' + repo.name, '-F', 'n=' + n]
      if (afterVal) args.push('-F', 'after=' + afterVal)
      else args.push('-F', 'after=')
      const r: any = await runGh(args, cwd)
      if (!r.ok) {
        if (isRateLimitError(r)) { try { if (logCtx) logCtx.fire('warn', 'graphql.fallback', { scope: '单票', reason: 'rate-limit' }) } catch (eL: any) {}; return fetchIssueCommentsREST(n, after, cwd) }
        if (r.kind === 'notfound' || /not found|could not resolve/i.test(String(r.error||''))) return { ok: false, error: { kind: 'notFound', message: String(r.error||'not found') } }
        if (r.kind !== 'network') return { ok: false, error: { kind: r.kind || 'network', message: String(r.error||'network') } }
        continue
      }
      try {
        const j: any = JSON.parse(r.text)
        if (j.errors) {
          if (isRateLimitError({ error: JSON.stringify(j.errors) })) { try { if (logCtx) logCtx.fire('warn', 'graphql.fallback', { scope: '单票', reason: 'rate-limit' }) } catch (eL: any) {}; return fetchIssueCommentsREST(n, after, cwd) }
          if (/not found|could not resolve/i.test(JSON.stringify(j.errors))) return { ok: false, error: { kind: 'notFound', message: JSON.stringify(j.errors).slice(0,300) } }
          return { ok: false, error: { kind: 'graphql', message: JSON.stringify(j.errors).slice(0,300) } }
        }
        const com: any = j.data && j.data.repository && j.data.repository.issue && j.data.repository.issue.comments
        if (!com) return { ok: false, error: { kind: 'notFound', message: 'issue not found' } }
        return { ok: true, nodes: com.nodes || [], pageInfo: com.pageInfo || { hasNextPage: false, endCursor: null } }
      } catch (e: any) { return { ok: false, error: { kind: 'parse', message: String(e) } } }
    }
    return { ok: false, error: { kind: 'network', message: 'GraphQL 评论分页请求失败（重试后仍失败）' } }
  }
  async function handleIssueDetail(args: any): Promise<any> {
    const n: any = args && args.number
    // #1003 空目录闸：不拿进程目录冒充去读票，诚实失败等就绪。
    const _rawDetailCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawDetailCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await normCwd(_rawDetailCwd)
    if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
    try {
      // 第一性原理分发：经 index 从会话启停模块转供给共享判据（H4 同例），不各留一份拷贝。
      const _sel: any = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
      const useTracker: any = isComposerSelection(_sel)
      if (useTracker) {
        const reg: any = await getTrackerRegistry()
        const backendId: any = _sel.backendId
        const tracker: any = reg.get(backendId)
        if (!tracker || typeof tracker.get !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + backendId + "' 未实现 get" } }
        let repoRef: any = null
        try { repoRef = reg.describe({ cwd }, backendId) } catch {}
        if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
        // effort 维度：effort 是寻址范围，客户端带上来就放进 ref（不带 = 全仓库，单 effort 后端行为不变）
        if (args && args.effortId !== undefined && args.effortId !== null) repoRef.effortId = String(args.effortId)
        const opCtx: any = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
        const key: string = String(n).padStart(2, '0')
        const r: any = await tracker.get(repoRef, key, {}, opCtx)
        if (!r || !r.ok) return r
        // 统一为 fetchIssueDetail 的返回形状（{ok, issue}），便于客户端复用
        const iss: any = r.data
        // 适配客户端期望的 issue 形状：补充 number / labels 节点等
        if (iss && iss.key != null && iss.number == null) {
          const nn: number = parseInt(iss.key, 10)
          if (!isNaN(nn)) iss.number = nn
        }
        // 将 key 归一为字符串
        if (iss && iss.key != null) iss.key = String(iss.key)
        // 详情需要包含 comments / blockedBy 等，markdown 的 get 已包含
        return { ok: true, issue: {
          number: iss.number != null ? iss.number : (iss.key ? parseInt(iss.key,10) : n),
          effortId: iss.effortId !== undefined && iss.effortId !== null ? String(iss.effortId) : '',
          title: iss.title || '',
          state: iss.state === 'closed' ? 'CLOSED' : 'OPEN',
          body: iss.body || '',
          url: iss.url || '',
          updatedAt: iss.updatedAt || '',
          createdAt: iss.createdAt || '',
          closedAt: iss.closedAt || null,
          author: iss.author,
          labels: { nodes: (iss.labels || []).map(function(l: any){ return { name: l.name, color: l.color || '' } }) },
          assignees: { nodes: (iss.assignees || []).map(function(a: any){ return typeof a === 'string' ? { login: a } : a }) },
          comments: iss.comments || { nodes: [] },
          subIssues: iss.subIssues || { totalCount: 0, nodes: [] },
          blockedBy: { nodes: (iss.blockedBy || []).map(function(b: any){ if (typeof b === 'number') return { number: b }; if (b && b.key != null) { const nn = parseInt(b.key,10); return { number: isNaN(nn) ? b.key : nn, title: b.title||'', state: b.state==='closed'?'CLOSED':'OPEN' }; } return b; }) },
          blocking: { nodes: [] },
        } }
      }
      // 快照已标是拉取请求时把提示直通给详情房，让详情房先查拉取请求（不经快照房与列表房，前端房也不动）
      const hintPR: any = args && args.isPullRequest === true ? { isPullRequest: true } : undefined
      const r: any = await fetchIssueDetail(Number(n), cwd, hintPR)
      return r
    } catch (e: any) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
  }
  async function handleIssueComments(args: any): Promise<any> {
    const n: any = args && args.number
    const after: any = args && args.after
    // #1003 空目录闸：同上。
    const _rawCommentsCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawCommentsCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await normCwd(_rawCommentsCwd)
    if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
    try {
      // 第一性原理分发：经 index 从会话启停模块转供给共享判据（H4 同例），不各留一份拷贝。
      const _sel: any = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
      const useTracker: any = isComposerSelection(_sel)
      if (useTracker) {
        const reg: any = await getTrackerRegistry()
        const backendId: any = _sel.backendId
        const tracker: any = reg.get(backendId)
        if (!tracker || typeof tracker.get !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + backendId + "' 未实现 get" } }
        let repoRef: any = null
        try { repoRef = reg.describe({ cwd }, backendId) } catch {}
        if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
        // effort 维度：评论也按 effort 寻址（不带 = 全仓库；多 effort 同号时后端会诚实报 conflict）
        if (args && args.effortId !== undefined && args.effortId !== null) repoRef.effortId = String(args.effortId)
        const opCtx: any = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
        const key: string = String(n).padStart(2, '0')
        const r: any = await tracker.get(repoRef, key, {}, opCtx)
        if (!r || !r.ok) return r
        const iss: any = r.data
        const nodes: any = (iss.comments || []).map(function(c: any){ return { author: c.author || { login: '' }, authorAssociation: c.authorAssociation || '', body: c.body || '', createdAt: c.createdAt || '', updatedAt: c.updatedAt || '' } })
        // 简单分页：after 为已加载数
        const afterNum: number = after != null ? Number(after) : 0
        const start: number = isNaN(afterNum) ? 0 : afterNum
        const pageNodes: any = nodes.slice(start, start + 50)
        const hasNext: boolean = start + 50 < nodes.length
        return { ok: true, nodes: pageNodes, pageInfo: { hasNextPage: hasNext, endCursor: String(start + pageNodes.length) } }
      }
      const r: any = await fetchIssueComments(Number(n), after != null ? String(after) : null, cwd)
      return r
    } catch (e: any) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
  }
  // #255 · IssueDetail 评论输入区（GitHub 单点 · MISSING 零分支）· 宿主透传 = 本次唯一宿主改动。
  // 第一性原理：能力 = 运行时事实（G5 调用即知，无能力表）；路径 = registry.select → tracker.comment（契约第 8 号 op），
  // 预检不进入评论链（去耦合：评论路径与预检仅共享错误分类常量）。成功即失效面板快照缓存（#213 白名单同语义），
  // 推进只来自重求值（client 击穿详情缓存重取 + probe 增量确认），无乐观插入。错误直透 TrackerError{kind,message}。
  async function handleCommentIssue(args: any): Promise<any> {
    const n: any = args && args.number
    const body: any = args && args.body
    // #1003 空目录闸：写操作更不许冒充（会写到错的仓库），直接拒绝等就绪。
    const _rawCommentCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawCommentCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await normCwd(_rawCommentCwd)
    if (!n || isNaN(Number(n))) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
    if (typeof body !== 'string' || !body.trim()) return { ok: false, error: { kind: 'parse', message: '评论内容为空' } }
    try {
      const reg: any = await getTrackerRegistry()
      if (!reg) return { ok: false, error: { kind: 'env', message: 'registry unavailable' } }
      const handle: any = { cwd: cwd }
      const opCtx: any = { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), caller: 'comment-threads', timers: hostTimers(timer), exec: async function(cmd: any, cargs: any, opts: any): Promise<any>{ const argv: any=[String(cmd)].concat(cargs||[]); const c: any=(opts&&opts.cwd)||cwd; const r: any=await execProc(argv, c, 'comment-write'); if(!r.ok) throw new Error(r.error||String(r.code||'exec failed')); return { stdout:r.text, text:r.text, ok:true, code:(Number.isInteger(r.code) ? r.code : 0) } } }
      let sel: any = null
      try { sel = await reg.select(handle, opCtx) } catch (eSel: any) {}
      if (!sel || !sel.backendId) return { ok: false, error: { kind: 'unsupported', message: '未选择可用 tracker 后端，无法评论' } }
      let repoRef: any = null
      try { repoRef = reg.describe({ cwd: cwd }, sel.backendId) } catch (eDesc: any) {}
      if (repoRef && !repoRef.refId && sel.backendId === 'github') {
        // refId 补全（host 编排职责，与 buildSnapshot 同语义：git remote → .git/config → gh repo view 三级解析）
        try {
          const rk: any = await getRepoKey(cwd)
          if (rk && rk.owner && rk.name) { repoRef.refId = rk.owner + '/' + rk.name; repoRef.name = repoRef.refId; repoRef.url = 'https://github.com/' + repoRef.refId }
        } catch (eRk: any) {}
      }
      if (!repoRef || !repoRef.refId) return { ok: false, error: { kind: 'not-found', message: '无法解析目标仓库（refId missing）' } }
      // effort 维度：effort 是寻址范围；客户端从行数据带上来，放进 ref（不带 = 全仓库）
      if (args && args.effortId !== undefined && args.effortId !== null) repoRef.effortId = String(args.effortId)
      const tracker: any = reg.get(sel.backendId)
      if (!tracker || typeof tracker.comment !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + sel.backendId + "' 未实现 comment" } }
      const r: any = await tracker.comment(repoRef, String(Number(n)), String(body), opCtx)
      if (r && r.ok) {
        // 写操作成功 → 失效面板快照缓存（#213 同语义；右侧列表增量由 client 静默重取快照经差异产出）
        try { setCache({ ts: 0, snapshot: null, error: null, cwd: cwd }) } catch {}
      }
      return r
    } catch (e: any) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
  }
  // v1.5 R2（#2 MVP）：probe 改用 `since` 时间戳探测全 issue 增量（地图 + 子票 + 其他），
  //   1 次 REST 调用覆盖全仓库变化。原实现 `labels=wayfinder:map` 仅匹配地图本身，
  //   **漏检所有子票变化**——面板可接/阻塞/已认领/已关闭分组（DESIGN.md §5.2）都是子票，
  //   故"列表不更新状态"。since 语义：返回数组非空 = 自上次快照以来有变化 → 视为 changed。
  //   配额仍走 REST 5000/h 池（独立于 GraphQL 5000 点/h），不烧穿。
  async function handleProbe(args: any): Promise<any> {
    // #1003 空目录闸：同上。
    const _rawProbeCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawProbeCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await canonicalKey(_rawProbeCwd)
    // 第一性原理分发：经 index 从会话启停模块转供给共享判据（H4 同例），不各留一份拷贝。
    // markdown 等走轻量 list 探针，github 仍走 gh issue index
    const _selProbe: any = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
    const useProbeTracker: any = isComposerSelection(_selProbe)
    if (useProbeTracker) {
      try {
        const reg: any = await getTrackerRegistry()
        const tracker: any = reg.get(_selProbe.backendId)
        if (tracker && typeof tracker.list === 'function') {
          let repoRef: any = null
          try { repoRef = reg.describe({ cwd }, _selProbe.backendId) } catch {}
          if (!repoRef) repoRef = { backend: _selProbe.backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || _selProbe.backendId, url: '' }
          const opCtx: any = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
          const r: any = await tracker.list(repoRef, {}, opCtx)
          if (!r || !r.ok) return { ok: false, error: errText((r && r.error) || 'probe list 失败') }
          const all: any[] = Array.isArray(r.data) ? r.data : []
          // 轻量索引：key -> state
          const idx: Record<string, string> = {}
          // effort 维度：探针索引按 (effort, 编号) 键入，否则两个 effort 的同号票会互相覆盖、第二个 effort 的变更探测不到
          all.forEach(function(it: any){ const k: any = it && (it.key != null ? idOfParts(it.effortId, String(it.key).padStart(2,'0')) : (it.number != null ? idOfParts(it.effortId, String(it.number).padStart(2,'0')) : '')); if(k) idx[k] = String(it.state||'OPEN').toUpperCase() })
          const rk1: string = _selProbe.backendId + ':' + cwd
          const known: any = lastIssueIndexByRepo[rk1] || {}
          const changed: any = issueIndexChanged(known, idx)
          rememberIssueIndex({ owner: _selProbe.backendId, name: cwd }, idx)
          // 兼容 remember 的 repoKey 形态：用 backendId+cwd 作 key，避免与 github 的 owner/name 串
          lastIssueIndexByRepo[rk1] = idx
          lastProbeAtByRepo[rk1] = new Date().toISOString()
          if (changed) setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
          return { ok: true, changed: changed, repo: { owner: _selProbe.backendId, name: String(cwd).split(/[\\/]/).pop()||'' }, count: all.length, since: lastProbeAtByRepo[rk1] }
        }
      } catch (e: any) { return { ok: false, error: errText(e) } }
    }
    try {
      // 增量索引（本轮新增）：改走 fetchIssueIndexWindowed —— 它只回答「自上次以来有没有变」，
      //   并把增量并进完整基线后给出 changed。这里不再自己维护一份基线、也不再自行比对：
      //   两份状态会各自漂移，而漂移的后果是面板长期显示旧数据且不报错（静默漏报，最难查）。
      // #723（T19c）第 E 件：探测说变了之后，**先把变的那几条补进列表**（src/refresh/rooms/host/row-patch.js 的
      //   行级增量：一张票一条薄查询），再回给客户端那一份补好的结果 —— 从前这一步没人做，
      //   客户端只能整池重建，于是「只补变的那几条」那条窄路白写了。
      //   水印只在这一步真的并进列表之后才推进（commitIssueIndex），被推迟 / 被丢弃 / 失败时
      //   一个字节都不动 —— 否则那条变化会被挤出下一次的扫描窗口，此后再也发现不了。
      const remote: any = await fetchIssueIndexWindowed(cwd)
      if (!remote.ok) return { ok: false, error: errText(remote.error || 'probe 失败') }
      const repo: any = remote.repo
      const rk1: string = repo.owner + '/' + repo.name
      const changed: boolean = remote.changed === true
      lastProbeAtByRepo[rk1] = new Date().toISOString()
      const commit: any = function (): any { try { return commitIssueIndex(cwd, remote.nextWatermarkMs, remote.index) } catch (eC: any) { return null } }
      if (!changed) {
        // 没变 = 列表与远端一致，推水印（与基线）是安全的（不推就要每拍重扫同一个窗口）。
        commit()
        return { ok: true, changed: false, repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
      }
      let delta: any = null
      try { delta = (typeof deltaRefresh === 'function') ? await deltaRefresh(cwd, {}) : null } catch (eD: any) { delta = null }
      if (delta && delta.mode === 'patch' && delta.rows && delta.rows.length) {
        // 并进列表了：水印与基线跟着走，客户端直接用这一份（不再发整池大查询）。
        commit()
        const cur: any = (typeof getCache === 'function') ? getCache(cwd) : null
        return {
          ok: true, changed: true, mode: 'patch', repo: repo, count: remote.count,
          rows: delta.rows, version: delta.version, queries: delta.queries, partial: delta.partial === true,
          snapshot: (cur && cur.snapshot) ? cur.snapshot : null, since: lastProbeAtByRepo[rk1],
        }
      }
      if (delta && delta.mode === 'nothing') {
        commit()
        return { ok: true, changed: false, mode: 'nothing', repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
      }
      if (delta && (delta.mode === 'deferred' || delta.mode === 'failed' || delta.mode === 'stale-dropped')) {
        // 没并进去：水印与基线一个字节都不动 —— 那条变化下一次仍然在窗口里、仍然会被发现；
        // 客户端这一拍什么都不用做（它就靠这个「没并进去」的回报原地不动）。
        return { ok: true, changed: true, mode: delta.mode, reason: String(delta.reason || ''), pending: delta.pending || 0, repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
      }
      // 该整池的那几档（冷启动 / 票号增减 / 条数过多 / 旧结构）：如实告诉客户端「这一次得整池」。
      // 这一档推水印与基线：客户端收到之后就会整池重建，那一次会把整仓重拿一遍，变化是被并进列表的
      // （不推的话每一拍都要从很旧的水印重扫，白烧额度）。
      if (changed) setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
      commit()
      return { ok: true, changed: true, mode: 'rebuild', reason: String((delta && delta.reason) || 'no-delta'), repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
    } catch (e: any) { return { ok: false, error: errText(e) } }
  }
  return { fetchIssueCommentsREST, fetchIssueComments, handleIssueDetail, handleIssueComments, handleCommentIssue, handleProbe }
}
