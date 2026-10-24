#!/usr/bin/env node
/**
 * #1465 详情读路径丢 owner 的接缝单测（TDD 红绿探针）。
 *
 * 为什么单独立一扇：读路径 repoRefFor 只调注册表 describe，
 * 对 GitHub 工作区只给目录时交回空 refId（describe 是房间的同步定位口，
 * 不认 owner/name），房间 get 就报 refId missing；写路径用会话回包
 * opened.repoRef 是对的（会话装配口已经过三级定位补齐），正确路另有一条
 * issue-detail-fetch 的 withReadSession 调 getRepoKey。二选一修一处，
 * 这里钉住第一种修法：读路径改用 opened.repoRef。
 *
 * 约定接缝：createCommentThreads 的 openSession 交回的 opened.repoRef。
 * 判据：describe 交回空 refId 时，详情与评论仍用会话回包的 owner/name 去调
 * session.get；会话没给仓库身份时诚实回 not-found（沿用写路径同档）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1465-detail-refid.ts
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
function check(cond, msg) {
  if (!cond) { console.error('FAIL', msg); process.exitCode = 1 } else { passed++; console.log('PASS', msg) }
}

const { createCommentThreads } = await import(pathToFileURL(resolve(ROOT, 'src/refresh/rooms/host/comment-thread-fetch.ts')).href)

const CWD = 'D:/work/repo'
const SESSION_REF = { backend: 'github', refId: 'o/r', name: 'o/r', url: 'https://github.com/o/r' }

// 真实 GitHub describe 的形状：只给目录时 refId 为空（丢 owner）。
const emptyDescribeRegistry = {
  describe: function () { return { backend: 'github', refId: '', name: 'repo', url: '' } },
  get: function () { throw new Error('读路径不应再经注册表 tracker.get') },
  select: async function () { return { backendId: 'github' } },
}

function makeDeps(openSession, registry) {
  return {
    openSession,
    normCwd: async function (x) { return x },
    selectEarly: async function () { throw new Error('不应调 selectEarly') },
    isComposerSelection: function () { throw new Error('不应调 isComposerSelection') },
    getTrackerRegistry: async function () { return registry },
    getPlatform: async function () { return {} },
    ctx: {},
    timer: {},
    DEFAULT_CWD: '',
    errText: function (e) { return String((e && e.message) || e) },
    isRateLimitError: function () { return false },
    getRepoKey: async function () { return { owner: 'o', name: 'r' } },
    execProc: async function () { throw new Error('读路径不应碰 exec') },
    fetchIssueDetail: async function () { throw new Error('不应回退旧详情路') },
    fetchIssueIndex: async function () { throw new Error('不应回退旧索引路') },
    issueIndexFromSnapshot: function () { return {} },
    setCache: function () {},
    logCtx: { fire: function () {} },
  }
}

function issueData(first) {
  const comments = []
  for (let i = 1; i <= first; i++) comments.push({ author: { login: 'u' + i }, authorAssociation: 'NONE', body: 'body ' + i, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' })
  return { key: '5', title: '票 5', state: 'open', body: '正文', url: 'https://github.com/o/r/issues/5', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', closedAt: null, author: { login: 'alice' }, labels: [], assignees: [], comments, blockedBy: [] }
}

// 详情：describe 为空时仍用会话回包的 refId 去调 get。
{
  const seen = []
  async function openSession(cwd) {
    return {
      ok: true, backendId: 'github', budget: {}, canWrite: false,
      repoRef: Object.assign({}, SESSION_REF),
      call: async function (fn) {
        const session = {
          get: async function (repoRef, key, opts, opCtx) { seen.push({ repoRef, key }); return { ok: true, data: issueData(50) } },
        }
        return fn(session, { cwd, caller: 'refresh' })
      },
    }
  }
  const h = createCommentThreads(makeDeps(openSession, emptyDescribeRegistry))
  const d = await h.handleIssueDetail({ number: 5, cwd: CWD })
  check(d && d.ok === true, '详情：describe 为空时仍成功（用会话回包）')
  check(seen.length === 1 && seen[0].repoRef && seen[0].repoRef.refId === 'o/r', '详情：session.get 拿到会话回包的 refId=o/r（不是 describe 的空串）')
}

// 评论首屏：同上，first=50 那一趟也用会话回包。
{
  const seen = []
  async function openSession(cwd) {
    return {
      ok: true, backendId: 'github', budget: {}, canWrite: false,
      repoRef: Object.assign({}, SESSION_REF),
      call: async function (fn) {
        const session = {
          get: async function (repoRef, key, opts, opCtx) { seen.push({ repoRef, key, opts }); return { ok: true, data: issueData(50) } },
        }
        return fn(session, { cwd, caller: 'refresh' })
      },
    }
  }
  const h = createCommentThreads(makeDeps(openSession, emptyDescribeRegistry))
  const c = await h.handleIssueComments({ number: 5, cwd: CWD })
  check(c && c.ok === true, '评论：describe 为空时仍成功')
  check(seen.length === 1 && seen[0].repoRef && seen[0].repoRef.refId === 'o/r', '评论：session.get 拿到会话回包的 refId=o/r')
  check(seen[0].opts && seen[0].opts.comments && seen[0].opts.comments.first === 50, '评论：first=50 不变')
}

// 会话没给仓库身份：诚实回 not-found（沿用写路径同档），不把空 refId 交给房间。
{
  async function openSession(cwd) {
    return {
      ok: true, backendId: 'github', budget: {}, canWrite: false,
      repoRef: null,
      call: async function (fn) { throw new Error('仓库身份缺失时不应再调房间') },
    }
  }
  const h = createCommentThreads(makeDeps(openSession, emptyDescribeRegistry))
  const d = await h.handleIssueDetail({ number: 5, cwd: CWD })
  check(d && d.ok === false && d.error && d.error.kind === 'not-found', '详情：会话无仓库身份时回 not-found（got ' + JSON.stringify(d && d.error) + '）')
  check(String(d && d.error && d.error.message).indexOf('refId missing') >= 0, '详情：消息说清 refId missing')
  const c = await h.handleIssueComments({ number: 5, cwd: CWD })
  check(c && c.ok === false && c.error && c.error.kind === 'not-found', '评论：会话无仓库身份时回 not-found')
}

console.log('\nverify-1465-detail-refid:', passed, 'passed,', process.exitCode ? 'with failures' : 'all green')
