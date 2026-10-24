/**
 * src/refresh/rooms/host/comment-thread-fetch.ts —— 单票详情与评论读写（来源：src/refresh/rooms/host/comment-thread-fetch.js，H5 #449 从 host/index.js 389–670 搬出电话体，纯结构、行为零变化；本次只加类型标注与注释，逻辑一行未动；#1429 C3 把探针处理器拆到 probe-handler.js，本文件只保留转交）。
 *
 * 为什么要有它（一句话）：单票详情、评论分页读写与面板增量探针原来都挤在宿主入口里，搬到这里之后调用点只按名取，
 * 详情字段与分页策略各自改各自的，不互相绊倒。
 *
 * 三条不能改的约定（改之前先看原来文件头那三行与调用点 index.js）：
 * 1. 由 index.js 动态引用加载，normCwd 与单票分发前奏经 index 转供给复用（H4 同例），不各留一份拷贝；本文件只引用原来那两个模块，不新增引用。
 * 2. #1444 起详情与评论的读路径经宿主注入的只读会话（deps.openSession）调房间 get，不再由调用方直调 gh；
 *    #1445 起评论写入同样只经写会话（deps.openSession 带 write:true）调房间 comment：选后端、问写权限、
 *    记账与解析仓库引用都归会话，本文件不再自己拼 opCtx、不再查注册表、也不再直调房间。
 *    会话开不成或能力失败时保留 {ok:false,error} 的失败形状，让上层照旧降级用缓存，不许抛、不许假装成功。
 * 3. 探针水印的约定搬到 probe-handler.ts（原来第 3 条，字句未动）：本文件不再经手水印。
 */

// 评论分页的两个数字（#1444）：首屏与每次「加载更多」各取 50 条，一次最多加载到 200 条。
// 这是契约 GetOpts.comments 的默认值与上限（三个后端房间同数），房间侧也会按 200 截断；
// 放在文件顶端一处，详情与评论两个处理器共用，不在函数里各写一份。
const COMMENTS_PAGE = 50
const COMMENTS_MAX = 200

// ---------------------------------------------------------------------------
// 类型（本次转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖全是函数与服务（目录归一、后端选择、注册表、平台、执行口、索引与缓存等），
// 形状按本文件实际用到的成员写成最小，全部用 any 接住；详情、评论、探针的回包都沿用原来的运行时形状，
// 类型只描述不约束，运行时行为一字不变。
// ---------------------------------------------------------------------------

/** 组装函数收到的依赖：目录归一、后端选择、注册表、执行口、索引与缓存等，全由调用点显式传入。 */
interface CommentThreadsDeps {
  /** #1444：拿只读会话的装配口（宿主接线注入；缺省时读路径诚实失败，不再退回直调 gh）。 */
  openSession?: any
  normCwd: any
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
  execProc: any
  fetchIssueDetail: any
  fetchIssueIndex: any
  issueIndexFromSnapshot: any
  setCache: any
  logCtx: any
}

/**
 * 组装单票详情与评论读写电话（依赖全显式传入；探针电话 #1429 D4 起由 probe-handler.ts 组装）。
 *
 * 为什么：五个电话共享同一套前奏（空目录闸、分发判据、仓库键），收在一个组装函数里只是为了与原来 index.js 的电话体一一对应。
 * 什么约定不能改：返回对象的五个字段名是调用点按名取的，改名调用点就拿不到。
 */
export function createCommentThreads(deps: CommentThreadsDeps): any {
  // 只取本文还有读者的几格：读写路径都改走会话之后，getPlatform / ctx / timer / getRepoKey / DEFAULT_CWD
  // 在这里已经没有调用点；字段仍留在接口上，是因为宿主接线 src/host/index.ts 照样按这些名字注入。
  // #1456 第 3 条：runGh 连注入带字段一起删了——它连读者都没有，留着只会让人以为读路径还直调 gh。
  // #1465：读路径不再调注册表 describe，getTrackerRegistry 也不再解构（接口保留，宿主照旧注入）。
  const { normCwd, errText, execProc, setCache } = deps as any
  // #1444：读路径只认只读会话（deps.openSession）。会话由宿主按目录选好后端，本文件不再自己分发、
  // 也不再直调 gh；开不成时如实失败，让上层照旧降级用缓存。
  async function openReadSession(cwd: any): Promise<any> {
    if (typeof deps.openSession !== 'function') return { ok: false, reason: 'not-wired', detail: '宿主没有注入只读会话装配口' }
    return await deps.openSession(cwd)
  }
  // 会话开不成时的失败形状：沿用本文件读路径原来的 {ok:false,error}。kind 归到 env ——
  // 这是环境没就绪（没认出工作区、没有可用后端、会话还在等），不是这张票不存在。
  function readSessionFailure(opened: any): any {
    const reason: string = opened && opened.reason ? String(opened.reason) : 'unknown'
    const detail: string = opened && opened.detail ? '：' + String(opened.detail) : ''
    return { ok: false, error: { kind: 'env', message: '这个工作区的只读会话没开成（' + reason + '）' + detail + '，等会话可用后再试。' } }
  }
  // 会话回包可能缺 data：缺了也按失败交回去，不让调用点读到 undefined 再炸。
  function getFailure(r: any): any {
    if (r && r.ok === false) return r
    return { ok: false, error: { kind: 'network', message: '只读会话没有交回单票数据' } }
  }
  // #1465：读路径的仓库引用直接用只读会话回包（opened.repoRef），不再调注册表 describe。
  // 为什么：describe 是房间的同步定位口，对 GitHub 工作区只给目录时交回空 refId（丢 owner），
  // 房间 get 就报 refId missing；会话装配口已经过三级定位把 owner/name 补齐（与写路径同一份），
  // 复制一份再挂 effortId（会话回包与判定结论是同一个对象，就地改会把范围带到别的调用上）。
  function readRepoRefOf(opened: any): any {
    return opened && opened.repoRef ? Object.assign({}, opened.repoRef) : null
  }
  // #1445：写路径只认写会话（deps.openSession 带 write:true）。选后端、问写权限（写入一律过裁决）、
  // 记账与解析仓库引用全由会话负责；本文件不再自己拼 opCtx、不再调注册表 select/describe，也不直调房间。
  // 为什么不能自己拼：写操作的额度与「这个工作区让不让写」只有会话那一层算得出来，自己拼等于绕过硬顶。
  async function openWriteSession(cwd: any, exec: any): Promise<any> {
    if (typeof deps.openSession !== 'function') return { ok: false, reason: 'not-wired', detail: '宿主没有注入写会话装配口' }
    // 执行口随会话一起交进去：会话默认那份是探测档（读），评论写入要按写档 'comment-write' 等得起一次真实往返。
    // canWrite:true —— 迁移前这条写路径不看判定出口的写权限（人在面板上点了评论，意图本身就是授权），
    // 仓库不可写时由房间把失败如实报回（auth/permission 档照旧）。收紧成「必须显式选过后端」会让老仓库今天能评论、迁移后不能。
    return await deps.openSession(cwd, { write: true, exec: exec, canWrite: true })
  }
  /**
   * 评论写入要用的执行口：房间按 DSH 契约调 exec(cmd, args, {cwd, timeout})，这里转成宿主那份 execProc。
   *
   * 什么约定不能改：返回形状与迁移前一字不差（房间既读 stdout 也读 text，且只认整数退出码）；
   * 失败照旧抛出 —— 房间的错误表要拿到 gh 原文才判得出档位，把它悄悄收成退出码 0 会把失败记成写入成功。
   */
  function makeCommentWriteExec(cwd: any): any {
    return async function (cmd: any, cargs: any, opts: any): Promise<any> {
      const argv: any = [String(cmd)].concat(cargs || [])
      const c: any = (opts && opts.cwd) || cwd
      const r: any = await execProc(argv, c, 'comment-write')
      if (!r.ok) throw new Error(r.error || String(r.code || 'exec failed'))
      return { stdout: r.text, text: r.text, ok: true, code: (Number.isInteger(r.code) ? r.code : 0) }
    }
  }
  // 写会话开不成时的失败形状：与读路径同一个形状（{ok:false,error}）。kind 归 env ——
  // 没认出工作区、没有后端认领、认领未决、多家同时认领，都是环境还没就绪，不是这张票不存在。
  function writeSessionFailure(opened: any): any {
    const reason: string = opened && opened.reason ? String(opened.reason) : 'unknown'
    const detail: string = opened && opened.detail ? '：' + String(opened.detail) : ''
    return { ok: false, error: { kind: 'env', message: '这个工作区的写会话没开成（' + reason + '）' + detail + '，等会话可用后再试。' } }
  }
  async function handleIssueDetail(args: any): Promise<any> {
    const n: any = args && args.number
    // #1003 空目录闸：不拿进程目录冒充去读票，诚实失败等就绪。
    const _rawDetailCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawDetailCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await normCwd(_rawDetailCwd)
    if (!n) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
    try {
      // 读路径只认会话（#1444）：会话开成之后，后端选择、读额度与记账都由它兜住，本文件不再自己分发。
      const opened: any = await openReadSession(cwd)
      if (!opened || opened.ok !== true) return readSessionFailure(opened)
      // #1465：仓库引用直接用只读会话回包（与写路径同一份），不再调 describe。
      const repoRef: any = readRepoRefOf(opened)
      if (!repoRef || !repoRef.refId) return { ok: false, error: { kind: 'not-found', message: '无法解析目标仓库（refId missing）' } }
      // effort 维度：effort 是寻址范围，客户端带上来就放进 ref（不带 = 全仓库，单 effort 后端行为不变）
      if (args && args.effortId !== undefined && args.effortId !== null) repoRef.effortId = String(args.effortId)
      const key: string = String(n).padStart(2, '0')
      const r: any = await opened.call(function (session: any, opCtx: any) {
        if (!session || typeof session.get !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + opened.backendId + "' 未实现 get" } }
        return session.get(repoRef, key, {}, opCtx)
      })
      if (!r || r.ok !== true) return getFailure(r)
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
      // 同详情：读评论也只经只读会话；会话开不成时诚实失败，让上层照旧用缓存。
      const opened: any = await openReadSession(cwd)
      if (!opened || opened.ok !== true) return readSessionFailure(opened)
      // 已加载条数就是这个文件的游标（endCursor 一直写的是这个数），夹在 0..200。
      const afterNum: number = after != null ? Number(after) : 0
      const loaded: number = isNaN(afterNum) ? 0 : Math.max(0, Math.min(COMMENTS_MAX, Math.floor(afterNum)))
      // 首屏 50；加载更多把 first 抬到「已加载 + 50」，到 200 为止。每次都从 0 取到 first，
      // 用整段替换房间交回的评论（契约的 Issue.comments 是数组，没有游标字段），再只交新增的一段。
      const want: number = Math.min(loaded + COMMENTS_PAGE, COMMENTS_MAX)
      // #1465：同详情，评论读路径也用只读会话回包（与写路径同一份）。
      const repoRef: any = readRepoRefOf(opened)
      if (!repoRef || !repoRef.refId) return { ok: false, error: { kind: 'not-found', message: '无法解析目标仓库（refId missing）' } }
      // effort 维度：评论也按 effort 寻址（不带 = 全仓库；多 effort 同号时后端会诚实报 conflict）
      if (args && args.effortId !== undefined && args.effortId !== null) repoRef.effortId = String(args.effortId)
      const key: string = String(n).padStart(2, '0')
      const r: any = await opened.call(function (session: any, opCtx: any) {
        if (!session || typeof session.get !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + opened.backendId + "' 未实现 get" } }
        return session.get(repoRef, key, { comments: { first: want } }, opCtx)
      })
      if (!r || r.ok !== true) return getFailure(r)
      const iss: any = r.data
      const all: any = (iss.comments || []).map(function(c: any){ return { author: c.author || { login: '' }, authorAssociation: c.authorAssociation || '', body: c.body || '', createdAt: c.createdAt || '', updatedAt: c.updatedAt || '' } })
      // 客户端拿到 nodes 后是逐条追加（src/client/kernel/api-io.ts 里的 existing.push），
      // 交全量会把已经加载过的评论再插一遍；这里只交 loaded 之后的新增段。
      const delta: any = all.slice(loaded)
      // hasNextPage：还没到 200，且这一趟按「50 条一档」拿满了；拿不满说明后端已经没有更多。
      const step: number = Math.min(COMMENTS_PAGE, COMMENTS_MAX - loaded)
      const hasNext: boolean = loaded + delta.length < COMMENTS_MAX && delta.length >= step
      return { ok: true, nodes: delta, pageInfo: { hasNextPage: hasNext, endCursor: String(loaded + delta.length) } }
    } catch (e: any) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
  }
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
      // #1445：写入只经写会话。上一版在这里自己选后端、拼 opCtx、补 refId、直调房间 comment，
      // 绕开了写权限裁决与写额度；现在这些一律交给会话，本文件只负责把参数交准、把失败说清楚。
      const opened: any = await openWriteSession(cwd, makeCommentWriteExec(cwd))
      if (!opened || opened.ok !== true) return writeSessionFailure(opened)
      // 仓库引用直接用会话回包（它已按「判定出口 → 房间 describe → git 三级解析」补齐）。
      // 复制一份再挂 effortId：会话回包里的 ref 与判定结论是同一个对象，就地改会把范围带到别的调用上。
      const repoRef: any = opened.repoRef ? Object.assign({}, opened.repoRef) : null
      if (!repoRef || !repoRef.refId) return { ok: false, error: { kind: 'not-found', message: '无法解析目标仓库（refId missing）' } }
      // effort 维度：effort 是寻址范围；客户端从行数据带上来，放进 ref（不带 = 全仓库）
      if (args && args.effortId !== undefined && args.effortId !== null) repoRef.effortId = String(args.effortId)
      const r: any = await opened.call(function (session: any, opCtx: any) {
        if (!session || typeof session.comment !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + opened.backendId + "' 未实现 comment" } }
        return session.comment(repoRef, String(Number(n)), String(body), opCtx)
      })
      if (r && r.ok) {
        // 写操作成功 → 失效面板快照缓存（#213 同语义；右侧列表增量由 client 静默重取快照经差异产出）
        try { setCache({ ts: 0, snapshot: null, error: null, cwd: cwd }) } catch {}
      }
      return r
    } catch (e: any) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
  }
  return { handleIssueDetail, handleIssueComments, handleCommentIssue }
}