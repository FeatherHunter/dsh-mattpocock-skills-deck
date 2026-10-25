#!/usr/bin/env node
/**
 * #1444 评论线程门禁：单票详情与评论首屏走只读会话，加载更多按 first 翻页，房间 get 认 GetOpts.comments.first。
 * #1445 起写评论也改走会话（openSession 带 write:true → session.comment），那一条路的参数、失败档与执行口一并钉在这里。
 *
 * 为什么单独立一扇：评论读路径从「调用方直调 gh」迁到「经 Tracker 只读会话调 get」之后，
 * 行为约定变了三处（首屏经会话、加载更多抬高 first、超过 200 截断），这三处没有任何既有门禁覆盖；
 * 写评论从「自己拼 opCtx + 注册表 select/describe + 房间 comment」迁到写会话之后，失败档与执行口也换了来源，同样没有既有门禁覆盖。
 *
 * #1519 起追加一条形状判据：详情回包里的 comments 必须是 {nodes, pageInfo} 连接（修前这里是数组透传，
 * 界面读 comments.nodes 读不到，评论区永远「评论 (0)」）。数组形状在这一层就不再算预期。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1444-comments.ts
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
function check (cond, msg) {
  if (!cond) { console.error('FAIL', msg); process.exitCode = 1 } else { passed++; console.log('PASS', msg) }
}

// ---------------------------------------------------------------------------
// 一、宿主侧：评论读写经会话（createCommentThreads）
// ---------------------------------------------------------------------------

const { createCommentThreads } = await import(pathToFileURL(resolve(ROOT, 'src/refresh/rooms/host/comment-thread-fetch.ts')).href)

// 300 条评论的假仓库：会话 get 按这一趟要的 first 返回前 N 条（与真实房间的截断语义一致）。
const ALL_COMMENTS = []
for (let i = 1; i <= 300; i++) {
  ALL_COMMENTS.push({
    id: 'c' + i,
    author: { login: 'u' + i },
    authorAssociation: 'NONE',
    body: 'body ' + i,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  })
}
function issueFor (opts) {
  const first = opts && opts.comments && typeof opts.comments.first === 'number' ? opts.comments.first : 50
  return {
    key: '5',
    title: '票 5',
    state: 'open',
    body: '正文',
    url: 'https://github.com/o/r/issues/5',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    closedAt: null,
    author: { login: 'alice' },
    labels: [],
    assignees: [],
    comments: ALL_COMMENTS.slice(0, Math.min(first, ALL_COMMENTS.length)),
    blockedBy: [],
  }
}

let openMode = 'ok' // ok / open-fail / get-fail
let openCalls = 0
const sessionCalls = []
const writeCalls = []
// 写会话（#1445）要看的三件事：开的是不是写会话、交回的仓库引用用没用上、执行口按哪一档调宿主。
let writeOpenCalls = 0
let lastWriteOpts = null
const SESSION_REF = { backend: 'github', refId: 'o/r', name: 'o/r', url: 'https://github.com/o/r' }
let writeRefMissing = false // 模拟「会话开了，但没解析出仓库身份」
let writeNoComment = false // 模拟「这个后端没有 comment 这一条能力」
let commentMode = 'ok' // ok / auth
let execMode = 'guard' // guard（读路径不许碰 exec）/ ok / fail
const execCalls = []

const tracker = {
  // 旧读路径是 reg.get(backendId).get(...)；这里故意抛错，证明读路径已经不再经过它。
  get: async function () { throw new Error('读路径不应再经注册表 tracker.get') },
  comment: async function (repoRef, key, body, opCtx) {
    writeCalls.push({ repoRef, key, body, opCtx })
    return { ok: true, data: { key: key, url: 'https://github.com/o/r/issues/5#issuecomment-1' } }
  },
}
const registry = {
  describe: function (handle, backendId) {
    return { backend: backendId, refId: 'o/r', name: 'o/r', url: 'https://github.com/o/r' }
  },
  get: function () { return tracker },
  select: async function () { return { backendId: 'github' } },
}

// 假会话：读会话只有 get；写会话（opts.write === true）多一条 comment，并交回仓库引用。
// 这样一旦写路径又回头去读会话、或者在某处自己拼 opCtx，下面的断言会当场抓到。
async function openSession (cwd, opts) {
  openCalls++
  const write = !!(opts && opts.write === true)
  if (write) { writeOpenCalls++; lastWriteOpts = opts }
  if (openMode === 'open-fail') return { ok: false, reason: 'workspace-not-ready', detail: '还没认出工作区' }
  return {
    ok: true,
    backendId: 'github',
    budget: {},
    canWrite: write,
    repoRef: writeRefMissing ? null : Object.assign({}, SESSION_REF),
    call: async function (fn) {
      const session = {
        backendId: 'github',
        canWrite: write,
        comment: (write && !writeNoComment) ? async function (repoRef, key, body, opCtx) {
          writeCalls.push({ repoRef, key, body, opCtx })
          if (commentMode === 'auth') return { ok: false, error: { kind: 'auth', message: '需要登录' } }
          return { ok: true, data: { key: key, url: 'https://github.com/o/r/issues/5#issuecomment-1' } }
        } : null,
        get: async function (repoRef, key, getOpts, opCtx) {
          sessionCalls.push({ repoRef, key, opts: getOpts, opCtx })
          if (openMode === 'get-fail') return { ok: false, error: { kind: 'rateLimit', message: '配额用完了' } }
          return { ok: true, data: issueFor(getOpts) }
        },
      }
      return fn(session, { cwd, caller: 'refresh' })
    },
  }
}

const deps = {
  openSession,
  normCwd: async function (x) { return x },
  // 读路径迁移后这两个判据不再参与；若有人把旧分发放回来，这里会立刻炸出来。
  selectEarly: async function () { throw new Error('读路径不应再调 selectEarly') },
  isComposerSelection: function () { throw new Error('读路径不应再调 isComposerSelection') },
  getTrackerRegistry: async function () { return registry },
  getPlatform: async function () { return { resolveExecutable: async function () { return 'gh' } } },
  ctx: { get: function () { return undefined } },
  timer: { timeout: function () { return function () {} } },
  DEFAULT_CWD: '',
  errText: function (e) { return String((e && e.message) || e) },
  isRateLimitError: function () { return false },
  getRepoKey: async function () { return { owner: 'o', name: 'r' } },
  runGh: async function () { throw new Error('读路径不应直调 gh') },
  // 默认档 'guard'：读路径一次都不许碰执行口，碰了就在这里炸出来。
  execProc: async function (argv, cwd, tier) {
    if (execMode === 'guard') throw new Error('读路径不应直调 exec')
    execCalls.push({ argv: argv.slice(), cwd: cwd, tier: tier })
    if (execMode === 'fail') return { ok: false, error: 'gh 退出码 4', code: 4 }
    return { ok: true, text: 'OUT', code: 0 }
  },
  fetchIssueDetail: async function () { throw new Error('读路径不应回退旧详情路') },
  fetchIssueIndex: async function () { throw new Error('读路径不应回退旧索引路') },
  issueIndexFromSnapshot: function () { return { ok: false } },
  setCache: function () {},
  logCtx: { fire: function () {} },
}

const handlers = createCommentThreads(deps)
const CWD = 'D:/work/repo'

// ① 详情经会话 get，评论首屏也经会话 get 且 first=50。
openMode = 'ok'
openCalls = 0
sessionCalls.length = 0
const detail = await handlers.handleIssueDetail({ number: 5, cwd: CWD, effortId: 1001 })
check(detail && detail.ok === true, '详情：经会话 get 成功')
// #1519：详情回包里的评论必须是 GraphQL 连接 {nodes, pageInfo}，不能把房间契约的数组原样透传给界面
// （界面只读 comments.nodes，数组透传时评论区永远显示「评论 (0)」）。
check(detail && detail.issue && detail.issue.comments && !Array.isArray(detail.issue.comments) && Array.isArray(detail.issue.comments.nodes) && detail.issue.comments.nodes.length === 50, '详情：评论按 {nodes, pageInfo} 连接交回、带回首屏 50 条（got ' + (detail && detail.issue && detail.issue.comments && detail.issue.comments.nodes && detail.issue.comments.nodes.length) + '）')
check(detail && detail.issue && detail.issue.comments && detail.issue.comments.pageInfo && detail.issue.comments.pageInfo.hasNextPage === true && detail.issue.comments.pageInfo.endCursor === '50', '详情：分页信息按首屏 50 条推出 hasNextPage=true、endCursor=50')
// 形状对了但字段掉了同样是坏的：作者、时间、正文都必须在，界面才画得出每一条评论。
check(detail && detail.issue && detail.issue.comments && detail.issue.comments.nodes[0] && detail.issue.comments.nodes[0].author && detail.issue.comments.nodes[0].author.login === 'u1' && detail.issue.comments.nodes[0].body === 'body 1' && detail.issue.comments.nodes[0].createdAt === '2026-10-01T00:00:00Z', '详情：首条评论的作者、正文与时间都带回来了')
check(openCalls === 1 && sessionCalls.length === 1, '详情：openSession 与 session.get 各一次')
check(sessionCalls[0] && sessionCalls[0].repoRef && sessionCalls[0].repoRef.refId === 'o/r', '详情：仓库引用经注册表 describe 解析（refId=o/r）')
check(sessionCalls[0] && sessionCalls[0].repoRef && sessionCalls[0].repoRef.effortId === '1001', '详情：effortId 放进仓库引用')
check(sessionCalls[0] && sessionCalls[0].key === '05', '详情：key 按两位补零')
check(sessionCalls[0] && sessionCalls[0].opts && !sessionCalls[0].opts.comments, '详情：不带 comments.first（沿用房间默认首屏）')

sessionCalls.length = 0
const firstPage = await handlers.handleIssueComments({ number: 5, cwd: CWD })
check(firstPage && firstPage.ok === true, '评论首屏：经会话 get 成功')
check(firstPage && firstPage.nodes && firstPage.nodes.length === 50, '评论首屏：交回 50 条（got ' + (firstPage && firstPage.nodes && firstPage.nodes.length) + '）')
check(sessionCalls[0] && sessionCalls[0].opts && sessionCalls[0].opts.comments && sessionCalls[0].opts.comments.first === 50, '评论首屏：first=50')
check(firstPage && firstPage.pageInfo && firstPage.pageInfo.hasNextPage === true && firstPage.pageInfo.endCursor === '50', '评论首屏：hasNextPage=true、endCursor=50')

// ② 加载更多：first 抬到「已加载 + 50」，只交新增的那一段，避免客户端 append 时重复。
sessionCalls.length = 0
const more = await handlers.handleIssueComments({ number: 5, cwd: CWD, after: '50' })
check(sessionCalls[0] && sessionCalls[0].opts && sessionCalls[0].opts.comments && sessionCalls[0].opts.comments.first === 100, '加载更多：first=100（已加载 50 + 50）')
check(more && more.nodes && more.nodes.length === 50, '加载更多：交回新增 50 条（got ' + (more && more.nodes && more.nodes.length) + '）')
check(more && more.nodes && more.nodes[0] && more.nodes[0].body === 'body 51', '加载更多：从第 51 条接着交（got ' + (more && more.nodes && more.nodes[0] && more.nodes[0].body) + '）')
check(more && more.pageInfo && more.pageInfo.hasNextPage === true && more.pageInfo.endCursor === '100', '加载更多：hasNextPage=true、endCursor=100')

// ③ 第三次加载到 200 条：截断、hasNextPage=false。
sessionCalls.length = 0
const third = await handlers.handleIssueComments({ number: 5, cwd: CWD, after: '150' })
check(sessionCalls[0] && sessionCalls[0].opts && sessionCalls[0].opts.comments && sessionCalls[0].opts.comments.first === 200, '第三次加载：first=200（上限）')
check(third && third.nodes && third.nodes.length === 50, '第三次加载：交回新增 50 条（got ' + (third && third.nodes && third.nodes.length) + '）')
check(third && third.nodes && third.nodes[0] && third.nodes[0].body === 'body 151', '第三次加载：从第 151 条接着交')
check(third && third.pageInfo && third.pageInfo.hasNextPage === false && third.pageInfo.endCursor === '200', '第三次加载：hasNextPage=false、endCursor=200')

// ④ 会话失败 / 会话开不成：如实回 {ok:false,error}，不抛、不假装成功。
openMode = 'get-fail'
const getFailDetail = await handlers.handleIssueDetail({ number: 5, cwd: CWD })
check(getFailDetail && getFailDetail.ok === false && getFailDetail.error && getFailDetail.error.kind === 'rateLimit', '会话 get 失败：详情原样回失败形状')
const getFailComments = await handlers.handleIssueComments({ number: 5, cwd: CWD })
check(getFailComments && getFailComments.ok === false && getFailComments.error && getFailComments.error.kind === 'rateLimit', '会话 get 失败：评论原样回失败形状')

openMode = 'open-fail'
sessionCalls.length = 0
const openFailDetail = await handlers.handleIssueDetail({ number: 5, cwd: CWD })
check(openFailDetail && openFailDetail.ok === false && openFailDetail.error && openFailDetail.error.kind === 'env', '会话开不成：详情回 {ok:false,error.kind=env}')
const openFailComments = await handlers.handleIssueComments({ number: 5, cwd: CWD })
check(openFailComments && openFailComments.ok === false && openFailComments.error && openFailComments.error.kind === 'env', '会话开不成：评论回 {ok:false,error.kind=env}')
check(sessionCalls.length === 0, '会话开不成：不再退回直调 gh（会话 get 零调用）')

// ⑤ 写评论（#1445）：只经写会话 —— openSession(cwd,{write:true}) → session.comment，票据与正文原样交房，
// 仓库引用用会话回包，执行口按 'comment-write' 档；失败档沿用本文件既有形状（env / not-found / unsupported / network）。
openMode = 'ok'
writeOpenCalls = 0
lastWriteOpts = null
writeCalls.length = 0
const openCallsBeforeWrite = openCalls
const written = await handlers.handleCommentIssue({ number: 5, body: '你好', cwd: CWD, effortId: 1001 })
check(written && written.ok === true, '写评论：成功回包原样透传')
check(writeOpenCalls === 1 && openCalls === openCallsBeforeWrite + 1, '写评论：每次写入开一次写会话')
check(lastWriteOpts && lastWriteOpts.write === true && typeof lastWriteOpts.exec === 'function', '写评论：开会话时带 write:true 与写入用的执行口')
check(writeCalls.length === 1 && writeCalls[0].key === '5' && writeCalls[0].body === '你好', '写评论：票号与正文原样交给房间 comment（票号不补零）')
check(writeCalls[0] && writeCalls[0].repoRef && writeCalls[0].repoRef.refId === 'o/r', '写评论：仓库引用用会话回包（不再自己 describe）')
check(writeCalls[0] && writeCalls[0].repoRef && writeCalls[0].repoRef.effortId === '1001', '写评论：effortId 照旧放进仓库引用')
check(writeCalls[0] && writeCalls[0].repoRef !== SESSION_REF, '写评论：交出去的是副本（不就地改会话/判定那份引用）')
check(writeCalls[0] && writeCalls[0].opCtx && writeCalls[0].opCtx.cwd === CWD, '写评论：操作上下文取会话给的那份（cwd 已归一）')

// 执行口：房间调 exec(cmd,args,{cwd}) → 宿主 execProc(['cmd',...args], cwd, 'comment-write')，
// 回包按 DSH 契约带 stdout/code；失败照旧抛出（房间的错误表要拿到 gh 原文才判得出档位）。
execMode = 'ok'
const execOut = await lastWriteOpts.exec('gh', ['api', 'graphql'], { cwd: CWD })
check(execOut && execOut.ok === true && execOut.stdout === 'OUT' && execOut.code === 0, '写评论执行口：成功时回 {stdout, code} 形状')
check(execCalls.length === 1 && execCalls[0].argv[0] === 'gh' && execCalls[0].argv[1] === 'api' && execCalls[0].tier === 'comment-write', "写评论执行口：按 'comment-write' 档调宿主 execProc")
execMode = 'fail'
let execThrew = ''
try { await lastWriteOpts.exec('gh', ['api', 'graphql'], { cwd: CWD }) } catch (eExec) { execThrew = String(eExec && eExec.message) }
check(execThrew === 'gh 退出码 4', '写评论执行口：失败时抛出原文（不悄悄收成退出码 0）')
execMode = 'guard'

// 失败档：写会话开不成 → env（与读路径同档、同形状）；会话开了但没仓库 → not-found；没 comment → unsupported。
openMode = 'open-fail'
writeCalls.length = 0
const writeOpenFail = await handlers.handleCommentIssue({ number: 5, body: '你好', cwd: CWD })
check(writeOpenFail && writeOpenFail.ok === false && writeOpenFail.error && writeOpenFail.error.kind === 'env', '写会话开不成：回 {ok:false,error.kind=env}')
check(String(writeOpenFail && writeOpenFail.error && writeOpenFail.error.message).indexOf('写会话没开成') >= 0, '写会话开不成：消息说清是写会话没开成（不是票不存在）')
check(writeCalls.length === 0, '写会话开不成：房间 comment 一次都没调')
openMode = 'ok'
writeRefMissing = true
const writeNoRef = await handlers.handleCommentIssue({ number: 5, body: '你好', cwd: CWD })
check(writeNoRef && writeNoRef.ok === false && writeNoRef.error && writeNoRef.error.kind === 'not-found', '写会话没给出仓库：回 {kind=not-found}（沿用原档位）')
writeRefMissing = false
writeNoComment = true
const writeUnsupported = await handlers.handleCommentIssue({ number: 5, body: '你好', cwd: CWD })
check(writeUnsupported && writeUnsupported.ok === false && writeUnsupported.error && writeUnsupported.error.kind === 'unsupported', '后端没有 comment：回 {kind=unsupported}')
writeNoComment = false
commentMode = 'auth'
const writeAuth = await handlers.handleCommentIssue({ number: 5, body: '你好', cwd: CWD })
check(writeAuth && writeAuth.ok === false && writeAuth.error && writeAuth.error.kind === 'auth', '房间回 auth：原样透传，不包成 network')
commentMode = 'ok'

// 参数档位不变：缺票号 / 正文空白先在本地拒掉，连会话都不开（少一次选后端）。
writeOpenCalls = 0
const writeNoNumber = await handlers.handleCommentIssue({ body: '你好', cwd: CWD })
const writeEmptyBody = await handlers.handleCommentIssue({ number: 5, body: '   ', cwd: CWD })
check(writeNoNumber && writeNoNumber.error && writeNoNumber.error.kind === 'parse', '写评论：缺 number → parse')
check(writeEmptyBody && writeEmptyBody.error && writeEmptyBody.error.kind === 'parse', '写评论：正文空白 → parse')
check(writeOpenCalls === 0, '写评论：参数不合格时不开会话')

// ---------------------------------------------------------------------------
// 二、房间侧：get 认 GetOpts.comments.first 并按游标翻页（上限 200，一页最多 100）
// ---------------------------------------------------------------------------

const { getIssue } = await import(pathToFileURL(resolve(ROOT, 'src/tracker/rooms/github/issues.ts')).href)
const { createOutboundControl } = await import(pathToFileURL(resolve(ROOT, 'src/refresh/rooms/host/outbound-control.ts')).href)

const RAW_COMMENTS = []
for (let i = 1; i <= 300; i++) {
  RAW_COMMENTS.push({
    id: 'c' + i,
    author: { login: 'u' + i },
    authorAssociation: 'NONE',
    body: 'body ' + i,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    lastEditedAt: null,
  })
}

const ghCalls = []
// 从 gh 参数里捞出这一趟的 GraphQL 查询串（参数形如 'query=...'）。
function queryOf (args) {
  const got = (args || []).find(function (a) { return String(a).startsWith('query=') })
  return got ? String(got).slice(6) : ''
}
function gqlBody (nodes, hasNextPage, endCursor) {
  return JSON.stringify({
    data: {
      repository: {
        issue: {
          number: 5,
          title: '票 5',
          state: 'OPEN',
          body: '',
          url: 'https://github.com/o/r/issues/5',
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-02T00:00:00Z',
          closedAt: null,
          author: { login: 'alice' },
          assignees: { nodes: [] },
          labels: { nodes: [] },
          milestone: null,
          comments: { nodes: nodes, pageInfo: { hasNextPage: hasNextPage, endCursor: endCursor } },
          parent: null,
          blockedBy: { nodes: [] },
        },
      },
    },
  })
}

const roomCtx = {
  cwd: ROOT,
  outbound: createOutboundControl(),
  platform: { resolveExecutable: async function (name) { return name === 'gh' ? 'gh' : null } },
  exec: async function (cmd, args) {
    ghCalls.push({ cmd: cmd, args: args })
    const queryArg = queryOf(args)
    const m = /comments\(first:(\d+)/.exec(queryArg)
    const first = m ? Number(m[1]) : 50
    const afterArg = args.find(function (a) { return String(a).startsWith('after=') })
    const start = afterArg ? Number(String(afterArg.slice(6)).replace('c', '')) : 0
    const page = RAW_COMMENTS.slice(start, start + first)
    const nextStart = start + page.length
    const hasNext = nextStart < RAW_COMMENTS.length
    return { code: 0, stdout: gqlBody(page, hasNext, 'c' + nextStart), stderr: '' }
  },
}
const repo = { refId: 'o/r', name: 'o/r' }

// 默认路径（不带 comments.first）保持原样：一条 GET_QUERY、评论 first:50。
ghCalls.length = 0
const legacy = await getIssue(repo, '5', {}, roomCtx)
check(legacy && legacy.ok === true && legacy.data.comments.length === 50, '房间 get：不带 comments.first 时仍取 50 条（got ' + (legacy && legacy.data && legacy.data.comments.length) + '）')
check(ghCalls.length === 1, '房间 get：默认路径一次请求（got ' + ghCalls.length + '）')
const legacyQuery = queryOf(ghCalls[0] && ghCalls[0].args)
check(legacyQuery.includes('comments(first:50)') && !legacyQuery.includes('after:$after'), '房间 get：默认查询仍是 comments(first:50)、不声明游标变量')

// first=120：第一页 100、第二页 20，两次请求，结果 120 条。
ghCalls.length = 0
const paged = await getIssue(repo, '5', { comments: { first: 120 } }, roomCtx)
check(paged && paged.ok === true, '房间 get：first=120 成功')
check(paged && paged.data.comments.length === 120, '房间 get：first=120 取回 120 条（got ' + (paged && paged.data && paged.data.comments.length) + '）')
check(ghCalls.length === 2, '房间 get：first=120 发了两次请求（got ' + ghCalls.length + '）')
const q1 = queryOf(ghCalls[0] && ghCalls[0].args)
const q2 = queryOf(ghCalls[1] && ghCalls[1].args)
check(q1.includes('comments(first:100'), '房间 get：第一页按一页上限取 100 条')
check(q2.includes('comments(first:20') && q2.includes('after:$after'), '房间 get：第二页取剩余 20 条并带游标变量')
check(!!(ghCalls[1] && ghCalls[1].args.includes('after=c100')), '房间 get：第二页游标取第一页的 endCursor（after=c100）')
check(paged && paged.data.comments[119] && paged.data.comments[119].body === 'body 120', '房间 get：第 120 条来自第二页')

// first=999：按契约上限 200 截断，最多两页。
ghCalls.length = 0
const capped = await getIssue(repo, '5', { comments: { first: 999 } }, roomCtx)
check(capped && capped.ok === true && capped.data.comments.length === 200, '房间 get：first=999 截到 200 条（got ' + (capped && capped.data && capped.data.comments.length) + '）')
check(ghCalls.length === 2, '房间 get：first=999 最多两页（got ' + ghCalls.length + '）')

// 小请求不翻页：first=30 只发一次。
ghCalls.length = 0
const small = await getIssue(repo, '5', { comments: { first: 30 } }, roomCtx)
check(small && small.ok === true && small.data.comments.length === 30, '房间 get：first=30 取回 30 条')
check(ghCalls.length === 1, '房间 get：first=30 不翻页（got ' + ghCalls.length + '）')

console.log('\nverify-1444-comments:', passed, 'passed,', process.exitCode ? 'with failures' : 'all green')