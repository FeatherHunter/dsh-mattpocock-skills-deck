#!/usr/bin/env node
/**
 * #1444 评论线程门禁：单票详情与评论首屏走只读会话，加载更多按 first 翻页，房间 get 认 GetOpts.comments.first。
 *
 * 为什么单独立一扇：评论读路径从「调用方直调 gh」迁到「经 Tracker 只读会话调 get」之后，
 * 行为约定变了三处（首屏经会话、加载更多抬高 first、超过 200 截断），这三处没有任何既有门禁覆盖；
 * 写评论那条路必须原样不动，也在这里钉住，防止读路径改造顺手把写侧牵连进去。
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

async function openSession (cwd) {
  openCalls++
  if (openMode === 'open-fail') return { ok: false, reason: 'workspace-not-ready', detail: '还没认出工作区' }
  return {
    ok: true,
    backendId: 'github',
    budget: {},
    call: async function (fn) {
      const session = {
        backendId: 'github',
        canWrite: false,
        get: async function (repoRef, key, opts, opCtx) {
          sessionCalls.push({ repoRef, key, opts, opCtx })
          if (openMode === 'get-fail') return { ok: false, error: { kind: 'rateLimit', message: '配额用完了' } }
          return { ok: true, data: issueFor(opts) }
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
  execProc: async function () { throw new Error('读路径不应直调 exec') },
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
check(detail && detail.issue && Array.isArray(detail.issue.comments) && detail.issue.comments.length === 50, '详情：带回首屏 50 条评论（got ' + (detail && detail.issue && detail.issue.comments && detail.issue.comments.length) + '）')
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

// ⑤ 写评论原样：走注册表 select → tracker.comment，不打开只读会话。
openMode = 'ok'
const openCallsBeforeWrite = openCalls
const written = await handlers.handleCommentIssue({ number: 5, body: '你好', cwd: CWD, effortId: 1001 })
check(written && written.ok === true, '写评论：成功回包原样透传')
check(writeCalls.length === 1 && writeCalls[0].key === '5' && writeCalls[0].body === '你好', '写评论：参数原样交给 tracker.comment')
check(writeCalls[0] && writeCalls[0].repoRef && writeCalls[0].repoRef.effortId === '1001', '写评论：effortId 照旧放进仓库引用')
check(openCalls === openCallsBeforeWrite, '写评论：没有打开只读会话（openSession 零调用）')

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