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

// #1694：详情读结果并进面板快照的唯一入口（按字段组掩码合并、版本门丢过期）。
// 这一层只做接线，合并规则全在 kernel/snapshot-merge.ts；详情返回形状保持原样，只是多一个 snapshot 字段。
// #1864：详情读结果按组写进本地快照库，并优先从库里读（详情本地优先、过期才取数）。
// #1865：评论也从库里读（读方向的换算与「加载更多」那一页都在 snapshot-library-view.ts）。
import { detailOfProjection, reviewNodeOf, storedCommentPage } from './snapshot-library-view.js'
// #1864：详情新鲜度的唯一来源是中央时间参数，不在本文件写数字。
import { ISSUE_DETAIL_LOCAL_TTL_MS } from '../../../shared/time-config/src/values.js'

// 评论分页的两个数字（#1444）：首屏与每次「加载更多」各取 50 条，一次最多加载到 200 条。
// 这是契约 GetOpts.comments 的默认值与上限（三个后端房间同数），房间侧也会按 200 截断；
// 放在文件顶端一处，详情与评论两个处理器共用，不在函数里各写一份。
const COMMENTS_PAGE = 50
const COMMENTS_MAX = 200

// #1864：详情在库里多久算「还新鲜」出自中央时间参数（config/ttl.yaml 的 issueDetailLocalTtlMs）：
// 新鲜就不发取数请求，过期才去后端取一趟并写回库。它是「什么时候该重取」的判据，不是
// 「能不能显示」的判据——过期数据照样显示，只是会顺手刷新。

/**
 * 库里这份详情算不算新鲜：上次已知时刻在 TTL 以内。时刻为 0 = 从没取过，一律算旧。
 *
 * 新鲜就完全不发取数请求（重启后第一次打开详情也走这条），过期才去后端取一趟并写回库。
 */
function isFreshDetail(issue: any): boolean {
  const at: number = issue && typeof issue.lastKnownAtMs === 'number' ? issue.lastKnownAtMs : 0
  if (at <= 0) return false
  return (Date.now() - at) <= ISSUE_DETAIL_LOCAL_TTL_MS
}

/**
 * 从库里读一张票的详情：补零与不补零两种票号都试（本地 Markdown 用 01、GitHub 用 1）。
 *
 * 为什么两种都试：列表写库时票号按后端原样存，而详情电话拿到的只有数字；只试一种会让另一个
 * 后端的本地优先永远不命中（每开一次详情都白取一趟）。读不出来一律当「库里没有」。
 */
/**
 * #1885 评审修复（规格 I2）：读回包要带这一趟对应的库版本。库门面没接、读失败、版本不是
 * 非负整数时回 null（不拿 0 冒充）；调用方按「不知道」处理，不往回包里写版本。
 */
async function libraryVersionOf(lib: any, libKey: any): Promise<number | null> {
  if (!lib || !libKey || typeof lib.readLibraryVersion !== 'function') return null
  try {
    const version = await lib.readLibraryVersion(libKey)
    return (typeof version === 'number' && Number.isInteger(version) && version >= 0) ? version : null
  } catch (e) {
    return null
  }
}

async function readLocalDetail(lib: any, libKey: any, paddedKey: string, plainKey: string, effortId: string): Promise<any> {
  const keys: string[] = paddedKey === plainKey ? [paddedKey] : [paddedKey, plainKey]
  for (const key of keys) {
    try {
      const found: any = await lib.readIssueDetail(Object.assign({ key: key, effortId: effortId }, libKey))
      if (found && found.issue) return found
    } catch (e) { /* 读不出来就当库里没有 */ }
  }
  return null
}

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
  fetchIssueIndex: any
  issueIndexFromSnapshot: any
  setCache: any
  /**
   * #1864：本地快照库门面（读详情 / 写详情）。缺省时整条本地优先关闭，行为与接线前一致。
   * 形状只要求两个方法，宿主接线按需注入，门禁可以给替身。
   */
  getSnapshotLibrary?: any
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
  // #1870：详情结果只写本地快照库（recordIssueDetail），不再并进宿主内存那份工作副本——
  // 面板读数据只走库，那份副本只是刷新内核的簿记，详情再写一遍属于双写。
  // #1444：读路径只认只读会话（deps.openSession）。会话由宿主按目录选好后端，本文件不再自己分发、
  // 也不再直调 gh；开不成时如实失败，让上层照旧降级用缓存。
  async function openReadSession(cwd: any): Promise<any> {
    if (typeof deps.openSession !== 'function') return { ok: false, reason: 'not-wired', detail: '宿主没有注入只读会话装配口' }
    return await deps.openSession(cwd)
  }
  // 会话开不成时的失败形状：沿用本文件读路径原来的 {ok:false,error}。kind 归到 env ——
  // 这是环境没就绪（没认出工作区、没有可用后端、会话还在等），不是这张票不存在。
  // #1572：会话为什么没开成，直接决定下一步该做什么 —— multi-match / no-backend 的下一步是
  // 在面板里选定这个工作区使用的后端，不是干等重试；pending 是还没定下来，等会话可用再试；
  // 其余（没认出工作区、没接上、开的时候抛了）保留原来的重试口径。文案只在这一处拼，读写共用。
  function sessionFailureAdvice(reason: string): string {
    if (reason === 'multi-match') return '。同时有多个后端认领这个工作区，请在面板里选定这个工作区使用的后端，再重试。'
    if (reason === 'no-backend') return '。这个工作区还没有选定后端，请在面板里选定这个工作区使用的后端，再重试。'
    if (reason === 'pending') return '。后端还在确认中，等会话可用后再试。'
    return '，等会话可用后再试。'
  }
  function sessionFailure(opened: any, sessionKind: '只读' | '写'): any {
    const reason: string = opened && opened.reason ? String(opened.reason) : 'unknown'
    const detail: string = opened && opened.detail ? '：' + String(opened.detail) : ''
    return { ok: false, error: { kind: 'env', message: '这个工作区的' + sessionKind + '会话没开成（' + reason + '）' + detail + sessionFailureAdvice(reason) } }
  }
  function readSessionFailure(opened: any): any {
    return sessionFailure(opened, '只读')
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
    return sessionFailure(opened, '写')
  }
  /**
   * 把刚发出去的那条评论并进本地快照库（#1866）。
   *
   * 为什么非做不可：详情现在是本地优先（#1864）——60 秒内再打开同一张票会直接从库交回。
   * 库里没有刚发的那一条，人就会看到「评论发出去了却不见了」。
   *
   * 回 true 只表示「提交进库了」。库打不开（降级）或事务没提交都回 false：调用方据此告诉界面
   * 「评论已经发出去了，但本地库没存上」，而不是把两种结局说成一种。
   */
  async function storeCommentReceipt(cwd: any, opened: any, repoRef: any, number: any, comment: any, body: string): Promise<{ stored: boolean, reason: string }> {
    const lib: any = (typeof deps.getSnapshotLibrary === 'function') ? await deps.getSnapshotLibrary().catch(function () { return null }) : null
    if (!lib || typeof lib.recordCommentReceipt !== 'function') return { stored: false, reason: 'library-unavailable' }
    const backend: string = String((opened && opened.backendId) || '')
    const repoIdentity: string = String((repoRef && repoRef.refId) || '')
    if (!backend) return { stored: false, reason: 'backend-missing' }
    const effortId: string = (repoRef && repoRef.effortId !== undefined && repoRef.effortId !== null) ? String(repoRef.effortId) : ''
    // 票号两种写法都交下去：本地 Markdown 存的是补零的键（05），GitHub 是不补零的（5）；
    // 库里按先到先得认一个已存在的键，写错键会在库里多出一张只有身份的骨架票。
    const padded: string = String(number).padStart(2, '0')
    const plain: string = String(number)
    const keys: string[] = padded === plain ? [padded] : [padded, plain]
    const value: any = (comment && typeof comment.body === 'string') ? comment : { body: String(body || '') }
    try {
      const res: any = await lib.recordCommentReceipt({
        workspaceRoot: cwd, backend: backend, repoIdentity: repoIdentity,
        keys: keys, effortId: effortId, comment: value,
      })
      const stored: boolean = !!(res && res.ok === true && res.degraded !== true)
      return { stored: stored, reason: stored ? '' : String((res && res.reason) || 'not-committed') }
    } catch (eR) { return { stored: false, reason: 'receipt-threw' } }
  }
  async function handleIssueDetail(args: any): Promise<any> {
    const n: any = args && args.number
    // #1003 空目录闸：不拿进程目录冒充去读票，诚实失败等就绪。
    const _rawDetailCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawDetailCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await normCwd(_rawDetailCwd)
    // 本地容器的编号是 0（key 00），是合法坐标：只拦缺席、空串与非数字，不拦 0。
    if (n === undefined || n === null || String(n).trim() === '' || isNaN(Number(n))) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
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
      // #1864：本地优先。库里有这张票的详情、而且还不算旧，就直接交回，一次取数请求都不发。
      // 库的键按「工作区 + 后端 + 仓库身份」三元组开，与列表写入用的是同一份身份；票号两种写法
      // 都要试：本地 Markdown 的键是补零的（01），GitHub 的键不补零（1），列表写库时按后端原样存。
      const lib: any = (typeof deps.getSnapshotLibrary === 'function') ? await deps.getSnapshotLibrary().catch(function () { return null }) : null
      const libKey: any = lib ? { workspaceRoot: cwd, backend: String(opened.backendId || ''), repoIdentity: String(repoRef.refId || '') } : null
      const effortIdOfDetail: string = (repoRef.effortId !== undefined && repoRef.effortId !== null) ? String(repoRef.effortId) : ''
      // 每个成功出口都带上库这一刻的版本（写完详情之后读，才是这一份的版本）。
      const finish = async function (reply: any): Promise<any> {
        const version = await libraryVersionOf(lib, libKey)
        if (version !== null) reply.version = version
        return reply
      }
      const local: any = libKey ? await readLocalDetail(lib, libKey, key, String(n), effortIdOfDetail) : null
      if (local && local.issue && !local.issue.referenceSkeleton && isFreshDetail(local.issue)) {
        return finish({ ok: true, issue: detailOfProjection(local.issue), fromSnapshot: true })
      }
      // #1931：详情写库要带「读开始那一刻」的库版本，不能等写的时候才读；这一读在发后端请求之前。
      const startMergeVersion: number | null = await libraryVersionOf(lib, libKey)
      const r: any = await opened.call(function (session: any, opCtx: any) {
        if (!session || typeof session.get !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + opened.backendId + "' 未实现 get" } }
        // 详情也要首屏这一页评论正文（#1783：#1784 之前这里不带 comments 选项，房间只能按默认一页 20 条取，
        // 页面于是把「详情里没带够」误当成「这张票只有 20 条评论」；带上 first 后房间会按需翻页并把总数带回来）。
        return session.get(repoRef, key, { comments: { first: COMMENTS_PAGE } }, opCtx)
      })
      if (!r || r.ok !== true) {
        // #1864：网络失败时库里有上次已知就照旧交回去（标 stale），页面不会空白；
        // 库里没有这张票才如实失败，不拿空壳冒充。
        if (local && local.issue && !local.issue.referenceSkeleton) {
          return finish({ ok: true, issue: detailOfProjection(local.issue), fromSnapshot: true, stale: true, refreshError: (r && r.error) || null })
        }
        return getFailure(r)
      }
      // 统一为 fetchIssueDetail 的返回形状（{ok, issue}），便于客户端复用
      const iss: any = r.data
      // #1864：取回来的详情按组写进库（正文、标签、父票、阻塞、子票计数、合并信息）。
      // 写库失败不影响这次回包：详情照常显示，下一趟打开再写。
      if (lib && libKey) {
        try {
          const payload: any = Object.assign({ issue: iss }, libKey)
          if (startMergeVersion !== null) payload.startMergeVersion = startMergeVersion
          await lib.recordIssueDetail(payload)
        } catch (eW) { /* 写库失败不影响这次详情 */ }
      }
      // 适配客户端期望的 issue 形状：补充 number / labels 节点等
      if (iss && iss.key != null && iss.number == null) {
        const nn: number = parseInt(iss.key, 10)
        if (!isNaN(nn)) iss.number = nn
      }
      // 将 key 归一为字符串
      if (iss && iss.key != null) iss.key = String(iss.key)
      // 评论：房间契约交回的是 Comment[] 数组，而详情页只认 GraphQL 连接形状 {nodes, pageInfo}
      // （旧路 issue-detail-fetch 的 detailOf 一直这么给，那个模块已随 #1870 退役）。#1444 换成经会话 get 之后
      // 这里把数组原样透传，界面读 comments.nodes 读不到，任意票的评论区都显示「评论 (0)」——#1519 的根因。
      // 所以在这一层把数组装回连接：每条评论的映射与旧路逐字一致（旧路的 detailOf 也只收窄这五个字段）。
      // hasNextPage 只能按「取满一页」推：这一趟沿用房间默认首屏（GitHub 房默认 COMMENTS_PAGE = 50 条），
      // 条数够一页就认为可能还有下一页；endCursor 用已取条数（旧 REST 路就是这么给的；
      // 「加载更多」另走 fetchIssueComments，不靠这个游标翻详情）。
      // 评论总数：契约 Issue.commentCount 是票面上的总数（GitLab 用 user_notes_count），
      // 它比「这次取到几条」可信；拿不到总数时才退回已取条数，并让 pageInfo 不再声称还有下一页。
      const knownTotal: any = typeof iss.commentCount === 'number' && isFinite(iss.commentCount) && iss.commentCount >= 0
        ? Math.floor(iss.commentCount)
        : null
      const comments: any = (iss.comments || []).map(function (c: any): any {
        return {
          author: { login: (c.author && c.author.login) || '' },
          authorAssociation: c.authorAssociation || '',
          body: c.body || '',
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }
      })
      // 详情需要包含 comments / blockedBy 等：markdown 的 get 在读时回填引用标题（#1537），
      // 界面拿到的就是带标题的形状，这里只做连接包装、不再补标题。
      const out: any = { ok: true, issue: {
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
        // hasNextPage 按总数判：已取到的还不到总数、且没到上限，才说还有下一页。
        // 只按「取满一页」推会在「整页正好取完」时说谎（#1783 的「评论 (0) 却可加载更多」是同一类问题）。
        comments: {
          nodes: comments,
          pageInfo: {
            hasNextPage: (knownTotal != null ? comments.length < knownTotal : false) && comments.length < COMMENTS_MAX,
            endCursor: String(comments.length),
          },
          // 总数放在连接层（GraphQL 连接的 totalCount 位）：界面说「评论 (20) · 共 56 条」、
          // 「加载更多」按钮的判断都读这里，pageInfo 只保留翻页游标。
          totalCount: knownTotal != null ? knownTotal : comments.length,
        },
        subIssues: iss.subIssues || { totalCount: 0, nodes: [] },
        // #1676：引用上的 state 可能缺省 = 没读到目标状态。节点就只给编号与标题；
        // 只有明确读到 open/closed 才写 OPEN/CLOSED —— 否则界面会把「不知道」当成「还开着」永久置灰。
        blockedBy: { nodes: (iss.blockedBy || []).map(function(b: any){
          if (typeof b === 'number') return { number: b }
          if (b && b.key != null) {
            const nn = parseInt(b.key, 10)
            const node: any = { number: isNaN(nn) ? b.key : nn, title: b.title || '' }
            if (b.state === 'closed') node.state = 'CLOSED'
            else if (b.state === 'open') node.state = 'OPEN'
            return node
          }
          return b
        }) },
        blocking: { nodes: [] },
      } }
      // #1870：拉取请求那三格照契约原样交回（isPullRequest / mergedAt / reviews）。
      // 以前这里逐字段挑，三格被丢掉了，界面只能回落到快照行：第一次点开一张拉取请求时，
      // 「这是 PR、只读、已合并」全靠那一行凑，详情回包自己说不出来。
      // 三态口径与契约一致：字段在就交（false / null / [] 都是「明确知道」），不在就整个省掉（不知道）。
      // 评审只留界面认的那三样，换算与库里读回来那条来源共用同一个函数（snapshot-library-view 的
      // reviewNodeOf），两条来源画出来一样，改形状只改一处。
      if (typeof iss.isPullRequest === 'boolean') out.issue.isPullRequest = iss.isPullRequest
      if (iss.mergedAt !== undefined) out.issue.mergedAt = iss.mergedAt
      if (Array.isArray(iss.reviews)) out.issue.reviews = iss.reviews.map(function (rv: any): any {
        return reviewNodeOf(rv && rv.state, rv && rv.reviewer && rv.reviewer.login, rv && rv.submittedAt)
      })
      return finish(out)
    } catch (e: any) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
  }
  async function handleIssueComments(args: any): Promise<any> {
    const n: any = args && args.number
    const after: any = args && args.after
    // #1003 空目录闸：同上。
    const _rawCommentsCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawCommentsCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await normCwd(_rawCommentsCwd)
    // 本地容器的编号是 0（key 00），是合法坐标：只拦缺席、空串与非数字，不拦 0。
    if (n === undefined || n === null || String(n).trim() === '' || isNaN(Number(n))) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
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
      // #1865：这一页库里已经取到过就直接从库交回，一次取数都不发。判据是「库里还有第 loaded + 1 条」
      // 而且这份详情还不算旧（与 #1864 的详情本地优先同一条 TTL）；库里没有这一页才去后端。
      const lib: any = (typeof deps.getSnapshotLibrary === 'function') ? await deps.getSnapshotLibrary().catch(function () { return null }) : null
      const libKey: any = lib ? { workspaceRoot: cwd, backend: String(opened.backendId || ''), repoIdentity: String(repoRef.refId || '') } : null
      const effortIdOfComments: string = (repoRef.effortId !== undefined && repoRef.effortId !== null) ? String(repoRef.effortId) : ''
      // 与详情同一口径：每个成功出口都带库版本（写完这一页之后读）。
      const finish = async function (reply: any): Promise<any> {
        const version = await libraryVersionOf(lib, libKey)
        if (version !== null) reply.version = version
        return reply
      }
      if (libKey) {
        const local: any = await readLocalDetail(lib, libKey, key, String(n), effortIdOfComments)
        if (local && local.issue && isFreshDetail(local.issue)) {
          const storedPage: any = storedCommentPage(local.issue, loaded, COMMENTS_PAGE)
          if (storedPage) return finish({ ok: true, nodes: storedPage.nodes, pageInfo: storedPage.pageInfo })
        }
      }
      // #1931：评论页写库同样带读开始那一刻的库版本（在发后端请求之前读）。
      const startMergeVersion: number | null = await libraryVersionOf(lib, libKey)
      const r: any = await opened.call(function (session: any, opCtx: any) {
        if (!session || typeof session.get !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + opened.backendId + "' 未实现 get" } }
        return session.get(repoRef, key, { comments: { first: want } }, opCtx)
      })
      if (!r || r.ok !== true) return getFailure(r)
      const iss: any = r.data
      // #1865：这一页按组写进库并推进游标。写失败不影响这次回包（下一趟还会再取）。
      if (lib && libKey) {
        try {
          const payload: any = Object.assign({ issue: iss }, libKey)
          if (startMergeVersion !== null) payload.startMergeVersion = startMergeVersion
          await lib.recordIssueComments(payload)
        } catch (eW) { /* 写库失败不影响这次回包 */ }
      }
      const all: any = (iss.comments || []).map(function(c: any){ return { author: c.author || { login: '' }, authorAssociation: c.authorAssociation || '', body: c.body || '', createdAt: c.createdAt || '', updatedAt: c.updatedAt || '' } })
      // 客户端拿到 nodes 后是逐条追加（src/client/kernel/api-io.ts 里的 existing.push），
      // 交全量会把已经加载过的评论再插一遍；这里只交 loaded 之后的新增段。
      const delta: any = all.slice(loaded)
      // 评论总数：契约 Issue.commentCount（票面总数）优先；拿不到才退回「已取条数」（也就不会再声称有下一页）。
      const knownTotal: any = typeof iss.commentCount === 'number' && isFinite(iss.commentCount) && iss.commentCount >= 0
        ? Math.floor(iss.commentCount)
        : null
      // hasNextPage：总数已知时，按「已取条数还没到总数、且没到 200 上限」判；
      // 总数未知时沿用旧口径（这一趟按 50 条一档拿满了，才认为后端可能还有更多）。
      const step: number = Math.min(COMMENTS_PAGE, COMMENTS_MAX - loaded)
      const hasNext: boolean = knownTotal != null
        ? loaded + delta.length < Math.min(knownTotal, COMMENTS_MAX)
        : loaded + delta.length < COMMENTS_MAX && delta.length >= step
      const totalCount: number = knownTotal != null ? knownTotal : loaded + delta.length
      return finish({ ok: true, nodes: delta, pageInfo: { hasNextPage: hasNext, endCursor: String(loaded + delta.length), totalCount } })
    } catch (e: any) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
  }
  async function handleCommentIssue(args: any): Promise<any> {
    const n: any = args && args.number
    const body: any = args && args.body
    // #1003 空目录闸：写操作更不许冒充（会写到错的仓库），直接拒绝等就绪。
    const _rawCommentCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawCommentCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await normCwd(_rawCommentCwd)
    // 本地容器的编号是 0（key 00），是合法坐标：只拦缺席、空串与非数字，不拦 0。
    if (n === undefined || n === null || String(n).trim() === '' || isNaN(Number(n))) return { ok: false, error: { kind: 'parse', message: '缺少 number' } }
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
        // #1866：写回执先提交进库，界面上那一条才有地方来。提交结果如实交回：stored 为假时
        // 客户端说「发出去了但没存上」，不把两种结局混成一句「成功」。
        const receipt: { stored: boolean, reason: string } = await storeCommentReceipt(cwd, opened, repoRef, n, r.data, String(body))
        return Object.assign({}, r, { stored: receipt.stored, storedReason: receipt.reason })
      }
      return r
    } catch (e: any) { return { ok: false, error: { kind: 'network', message: errText(e) } } }
  }
  return { handleIssueDetail, handleIssueComments, handleCommentIssue }
}