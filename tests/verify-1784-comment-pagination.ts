#!/usr/bin/env node
/**
 * #1784 门禁：GitLab 评论只取第一页 20 条，加载更多看不到剩下的评论，页面也没有「已显示 x / 共 N」。
 *
 * 为什么单独立这扇门：评论分页在三个地方各有一半责任 ——
 *   房间（src/tracker/rooms/gitlab/issues/read.ts 的 getIssue）要认 GetOpts.comments.first 并按 per_page 真翻页；
 *   房间的 Issue 要给出 commentCount（总数），调用方不能拿「这一页取到几条」当总数；
 *   宿主（src/refresh/rooms/host/comment-thread-fetch.ts）要把总数带进 pageInfo 与回包，
 *   而不是按「取满 50 条」这个固定常数去猜还有没有下一页。
 * 修前这三处都有洞：GitLab 忽略 first、固定只取一页 20 条、没有 commentCount 可判，宿主只好按 50 猜，
 * 结果 56 条评论的票永远只能看到 20 条，且回包说「没有下一页」。
 *
 * 判据（用 #28 那张 56 条评论的票做夹具）：
 *   ① 详情首屏要 50 条 → 房间按 per_page=50&page=1 取回 50 条，并给出 commentCount=56；
 *   ② 加载更多要 100 条 → 房间取回 56 条；宿主 loaded=50 时只交新增 6 条，pageInfo 说没有下一页、游标 56；
 *   ③ 单页上限 100：要 500 条也不会把 per_page 撑到 500；
 *   ④ 不带评论选项的老调用方保持旧行为（一页 20 条、请求不带分页查询串）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1784-comment-pagination.ts
 */
// 门禁归属: src/tracker/rooms/gitlab/issues/read.ts
// 门禁归属: src/tracker/rooms/gitlab/model/normalize.ts
// 门禁归属: src/refresh/rooms/host/comment-thread-fetch.ts
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(resolve(ROOT, rel)).href)
let failed = 0
function check (cond: any, msg: string): void {
  if (cond) console.log('  PASS ' + msg)
  else { failed++; console.log('  FAIL ' + msg) }
}

// ---------------------------------------------------------------------------
// 一、GitLab 房间读单票：认 comments.first，按 per_page 翻页取够，并给出总数
// ---------------------------------------------------------------------------
// 夹具照着 #28 的独立读回造：注释里说 56 条，独立 glab api 也是 56 条（user_notes_count=56）。
const NOTES: any[] = []
for (let i = 1; i <= 56; i++) {
  NOTES.push({
    id: 4133926088 + i,
    body: 'note ' + i,
    author: { username: 'u' + i },
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  })
}
const RAW_ISSUE = {
  iid: 28,
  title: '评论加载测试票（56 条评论）',
  state: 'opened',
  description: '这张票用来验评论列表、加载更多与发评论写回。',
  web_url: 'https://gitlab.example.com/group/proj/-/issues/28',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T01:00:00Z',
  user_notes_count: 56,
  labels: [],
  assignees: [{ id: 1, username: 'alice' }],
  author: { username: 'alice' },
}
function makeCtx (requests: string[]): any {
  return {
    cwd: 'D:/ws',
    platform: { resolveExecutable: async () => 'glab' },
    exec: async (_cmd: any, args: any) => {
      const path = String((args && args[1]) || '')
      requests.push(path)
      const at = path.indexOf('?')
      const base = at >= 0 ? path.slice(0, at) : path
      const q = new URLSearchParams(at >= 0 ? path.slice(at + 1) : '')
      if (/\/issues\/28$/.test(base)) return { stdout: JSON.stringify(RAW_ISSUE), stderr: '', code: 0 }
      if (/\/issues\/28\/notes$/.test(base)) {
        const perPage = q.has('per_page') ? Number(q.get('per_page')) : 20
        const pageNo = q.has('page') ? Number(q.get('page')) : 1
        const slice = NOTES.slice((pageNo - 1) * perPage, pageNo * perPage)
        return { stdout: JSON.stringify(slice), stderr: '', code: 0 }
      }
      return { stdout: '[]', stderr: '', code: 0 }
    },
  }
}

const { getIssue } = await imp('src/tracker/rooms/gitlab/issues/read.ts')
const REPO = { backend: 'gitlab', refId: 'group/proj' }
async function readIssue (opts?: any): Promise<any> {
  const requests: string[] = []
  const ctx = makeCtx(requests)
  const r = await getIssue(ctx, REPO, '28', opts, ctx)
  return { r, requests }
}

{
  const { r, requests } = await readIssue({ comments: { first: 50 } })
  const comments = (r && r.data && r.data.comments) || []
  check(r && r.ok === true, '详情 first=50：读票成功')
  check(comments.length === 50, '详情 first=50：交回 50 条评论（实得 ' + comments.length + ' 条）')
  check(comments[0] && comments[0].body === 'note 1' && comments[49] && comments[49].body === 'note 50', '详情 first=50：评论正文按顺序原样带回来')
  check(r && r.data && r.data.commentCount === 56, '详情 first=50：Issue.commentCount 给出总数 56（实得 ' + (r && r.data && r.data.commentCount) + '）')
  check(requests.some((p: string) => p.indexOf('/issues/28/notes?per_page=50&page=1') >= 0), '详情 first=50：评论请求带 per_page=50&page=1（GitLab 默认一页只有 20 条，不够）')
  check(!requests.some((p: string) => /\/notes\?.*page=2/.test(p)), '详情 first=50：取够本页就停，不白翻下一页')
}
{
  const { r, requests } = await readIssue({ comments: { first: 100 } })
  const comments = (r && r.data && r.data.comments) || []
  check(r && r.ok === true && comments.length === 56, '加载更多 first=100：交回全部 56 条（实得 ' + comments.length + ' 条）')
  check(requests.some((p: string) => p.indexOf('/notes?per_page=100&page=1') >= 0), '加载更多 first=100：按 per_page=100 请求')
}
{
  const { r, requests } = await readIssue({ comments: { first: 500 } })
  const comments = (r && r.data && r.data.comments) || []
  check(r && r.ok === true && comments.length === 56, '要 500 条（夹到上限 200）：仍能读回 56 条（实得 ' + comments.length + ' 条）')
  check(requests.some((p: string) => p.indexOf('/notes?per_page=100&page=1') >= 0), '要 500 条：单页按上限 100 请求（GitLab per_page 上限）')
  check(!requests.some((p: string) => p.indexOf('per_page=500') >= 0), '要 500 条：没有把 500 直接交给 per_page')
}
{
  const { r, requests } = await readIssue(undefined)
  const comments = (r && r.data && r.data.comments) || []
  const noteReqs = requests.filter((p: string) => /\/notes$/.test(p))
  check(r && r.ok === true && comments.length === 20, '不带评论选项：维持旧行为一页 20 条（实得 ' + comments.length + ' 条）')
  check(noteReqs.length === 1 && noteReqs[0].indexOf('?') < 0, '不带评论选项：评论请求不带分页查询串（与改动前一致）')
}

// ---------------------------------------------------------------------------
// 二、宿主：首屏向房间要 50 条并把总数带回来；加载更多按总数判有没有下一页
// ---------------------------------------------------------------------------
const { createCommentThreads } = await imp('src/refresh/rooms/host/comment-thread-fetch.ts')
const HOST_COMMENTS: any[] = []
for (let i = 1; i <= 56; i++) {
  HOST_COMMENTS.push({
    id: 'c' + i,
    author: { login: 'u' + i },
    authorAssociation: 'NONE',
    body: 'body ' + i,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  })
}
const readCalls: any[] = []
function hostIssue (first: number): any {
  return {
    key: '28',
    title: '评论加载测试票（56 条评论）',
    state: 'open',
    body: '这张票用来验评论列表、加载更多与发评论写回。',
    url: 'https://gitlab.example.com/group/proj/-/issues/28',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T01:00:00Z',
    closedAt: null,
    author: { login: 'alice' },
    labels: [],
    assignees: [],
    comments: HOST_COMMENTS.slice(0, Math.min(first, HOST_COMMENTS.length)),
    commentCount: 56,
    blockedBy: [],
  }
}
const hostDeps: any = {
  openSession: async function () {
    return {
      ok: true,
      backendId: 'gitlab',
      repoRef: { backend: 'gitlab', refId: 'group/proj', name: 'group/proj', url: 'https://gitlab.example.com/group/proj' },
      call: async function (fn: any) {
        const session = {
          backendId: 'gitlab',
          get: async function (_repoRef: any, _key: any, getOpts: any) {
            readCalls.push(getOpts)
            const first = getOpts && getOpts.comments && typeof getOpts.comments.first === 'number' ? getOpts.comments.first : 20
            return { ok: true, data: hostIssue(first) }
          },
        }
        return fn(session, { cwd: 'D:/ws', caller: 'refresh' })
      },
    }
  },
  normCwd: async function (x: any) { return x },
  errText: function (e: any) { return String((e && e.message) || e) },
  execProc: async function () { throw new Error('详情/评论读路径不应直调 exec') },
  setCache: function () {},
  logCtx: { fire: function () {} },
}
const handlers = createCommentThreads(hostDeps)
const CWD = 'D:/ws'
const detail = await handlers.handleIssueDetail({ number: 28, cwd: CWD })
const dc = detail && detail.ok === true && detail.issue && detail.issue.comments
check(detail && detail.ok === true, '宿主详情：成功')
check(!!dc && Array.isArray(dc.nodes) && dc.nodes.length === 50, '宿主详情：首屏交回 50 条评论（实得 ' + (dc && dc.nodes && dc.nodes.length) + ' 条）')
check(!!dc && dc.pageInfo && dc.pageInfo.hasNextPage === true, '宿主详情：还有下一页（56 条 > 这一页 50 条）')
check(!!dc && dc.pageInfo && dc.pageInfo.endCursor === '50', '宿主详情：游标是已取条数 50')
check(!!dc && dc.totalCount === 56, '宿主详情：交回总数 56（实得 ' + (dc && dc.totalCount) + '）')
check(readCalls.length >= 1 && readCalls[0] && readCalls[0].comments && readCalls[0].comments.first === 50, '宿主详情：向房间要首屏 50 条（修复前不带 comments 选项，GitLab 只回 20 条）')

const more = await handlers.handleIssueComments({ number: 28, cwd: CWD, after: '50' })
const lastCall = readCalls[readCalls.length - 1]
check(more && more.ok === true, '宿主加载更多：成功')
check(!!lastCall && lastCall.comments && lastCall.comments.first === 100, '宿主加载更多：把 first 抬到 100（实得 ' + (lastCall && lastCall.comments && lastCall.comments.first) + '）')
check(more && Array.isArray(more.nodes) && more.nodes.length === 6, '宿主加载更多：只交新增的 6 条（实得 ' + (more && more.nodes && more.nodes.length) + ' 条）')
check(more && more.nodes && more.nodes[0] && more.nodes[0].body === 'body 51', '宿主加载更多：第一条是第 51 条评论')
check(more && more.pageInfo && more.pageInfo.hasNextPage === false, '宿主加载更多：56 条已全部取到，不再说还有下一页')
check(more && more.pageInfo && more.pageInfo.endCursor === '56', '宿主加载更多：游标推进到 56')
check(more && more.pageInfo && more.pageInfo.totalCount === 56, '宿主加载更多：回包仍带总数 56')

if (failed) {
  console.log('\n[verify-1784] FAIL（' + failed + ' 项）')
  process.exit(1)
}
console.log('\n[verify-1784] GREEN 评论分页与总数就绪')
