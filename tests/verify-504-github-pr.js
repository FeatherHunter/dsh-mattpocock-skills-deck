#!/usr/bin/env node
/**
 * 回归门禁：GitHub 房拉取请求 #504 专用契约探针（双源等价 / 坏值收空 / 雾证据 / 坏节点可观测）。
 *
 * 只覆盖 GitHub 房与本探针文件，不碰界面、不碰快照组装、不碰 Markdown 与 GitLab。
 * 运行：node --no-warnings tests/verify-504-github-pr.js
 *
 * 四件事（都是把真模块跑起来看结果，不读源码文本）：
 *  1. 双源等价：同一张拉取请求用 GraphQL 节点与 REST 对象分别归一，三字段一致。
 *  2. 坏值收空：评审缺结论、合并时间为数字等坏值收敛为空值，不抛错。
 *  3. 雾证据：合成失败按超时、限流、企业版主机、通用四种原因分别落降级事件，不恒写通用原因。
 *  4. 坏节点可观测：列表逐票归一失败只丢坏票，好票保留，并复用已有调试事件记一行计数。
 *
 * 原先还夹着四段读源码文本的断言（能力位键、片段缺边、取舍注记、坏节点事件名），
 * 断言对象是手写源码文本，等价重构就会误报，已按维护者要求清掉。
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function check(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exitCode = 1 } else console.log('PASS', msg) }

const { normalizeIssue } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/backends/github/normalize.js')).href)
const { listIssues } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/backends/github/issues.js')).href)

// ---------- 1) 行为：双源等价 ----------
const gqlPR = {
  number: 493, title: 'pr title', state: 'OPEN', body: 'b', url: 'https://github.com/o/r/pull/493',
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z', closedAt: null, mergedAt: '2024-02-01T00:00:00Z',
  author: { login: 'alice' }, assignees: { nodes: [] }, labels: { nodes: [] }, milestone: null,
  comments: { nodes: [] }, reviews: { nodes: [{ state: 'approved', author: { login: 'alice' }, submittedAt: '2024-01-31T00:00:00Z' }] },
}
const restPR = {
  number: 493, title: 'pr title', state: 'open', body: 'b', html_url: 'https://github.com/o/r/pull/493',
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-02T00:00:00Z', closed_at: null, merged_at: '2024-02-01T00:00:00Z',
  user: { login: 'alice' }, labels: [], reviews: [{ state: 'approved', author: { login: 'alice' }, submitted_at: '2024-01-31T00:00:00Z' }],
}
const a = normalizeIssue(gqlPR)
const b = normalizeIssue(restPR)
check(a.isPullRequest === true && b.isPullRequest === true, '双源等价：两路都认出是拉取请求')
check(a.mergedAt === '2024-02-01T00:00:00Z' && b.mergedAt === '2024-02-01T00:00:00Z', '双源等价：合并时间一致')
check(Array.isArray(a.reviews) && a.reviews.length === 1 && b.reviews.length === 1 && a.reviews[0].state === 'approved', '双源等价：评审明细一致')

// ---------- 2) 行为：坏值收空 ----------
const badReviews = normalizeIssue({ number: 1, title: 't', state: 'open', reviews: [{ reviewer: { login: 'x' } }, null, 'nope'], mergedAt: 12345 })
check(Array.isArray(badReviews.reviews) && badReviews.reviews.length === 0, '坏值收空：缺结论的评审被丢弃（got ' + JSON.stringify(badReviews.reviews) + '）')
check(badReviews.mergedAt === null, '坏值收空：数字合并时间收敛为空')
check(badReviews.isPullRequest === true, '坏值收空：评审键存在仍判为拉取请求（布尔不断言缺失）')
const empty = normalizeIssue({})
check(empty.isPullRequest === false && empty.mergedAt === null && Array.isArray(empty.reviews) && empty.reviews.length === 0, '能力位：空来源逐票必带三字段空值（假、空、空数组）')

// ---------- 3) 行为：雾证据四原因（合成，不碰真仓） ----------
function makeCtx(failStderr, ghHost) {
  const logs = []
  return {
    logs,
    ctx: {
      cwd: ROOT,
      platform: {
        resolveExecutable: async (n) => (n === 'gh' ? 'gh' : null),
        env: { get: (k) => (k === 'GH_HOST' ? (ghHost || '') : '') },
      },
      exec: async (cmd, args) => {
        const joined = (args || []).join(' ')
        if (joined.includes('graphql')) return { code: 1, stdout: '', stderr: failStderr }
        if (joined.includes('/issues?state=all')) return { code: 0, stdout: JSON.stringify([{ number: 1, title: 't', state: 'open', labels: [], user: { login: 'a' }, html_url: 'https://github.com/o/r/issues/1' }]), stderr: '' }
        if (joined.includes('/pulls?state=all')) return { code: 0, stdout: '[]', stderr: '' }
        if (joined.includes('/sub_issues')) return { code: 0, stdout: '[]', stderr: '' }
        return { code: 1, stdout: '', stderr: 'unexpected:' + joined.slice(0, 80) }
      },
      logEvent: (level, event, fields) => { logs.push({ level, event, fields }) },
      isEnabled: () => true,
    },
  }
}
const repo = { refId: 'o/r', name: 'o/r' }
for (const c of [
  { name: '通用网络断流', stderr: 'Post "https://api.github.com/graphql": unexpected EOF', host: '', want: 'graphql-error' },
  { name: '超时', stderr: 'Post "https://api.github.com/graphql": timeout after 30s', host: '', want: 'timeout' },
  { name: '限流', stderr: 'API rate limit exceeded for user (429)', host: '', want: 'rate-limit' },
  { name: '企业版主机', stderr: 'Post "https://ghe.example.com/api/graphql": unexpected EOF', host: 'ghe.example.com', want: 'ghe-host' },
]) {
  const { logs, ctx } = makeCtx(c.stderr, c.host)
  const res = await listIssues(repo, {}, ctx)
  const fb = logs.find((l) => l.event === 'graphql.fallback')
  check(res && res.ok === true, '雾证据[' + c.name + ']：降级后 REST 仍返回')
  check(!!fb && fb.fields && fb.fields.reason === c.want, '雾证据[' + c.name + ']：原因=' + c.want + '（got ' + (fb && fb.fields && fb.fields.reason) + '）')
}
{
  // 三合成原因互不相同且不复用恒值
  const reasons = []
  for (const c of [
    { stderr: 'timeout', host: '' },
    { stderr: 'API rate limit exceeded', host: '' },
    { stderr: 'boom', host: 'ghe.example.com' },
  ]) {
    const { logs, ctx } = makeCtx(c.stderr, c.host)
    await listIssues(repo, {}, ctx)
    reasons.push((logs.find((l) => l.event === 'graphql.fallback') || {}).fields?.reason)
  }
  check(new Set(reasons).size === 3 && !reasons.includes('graphql-error'), '雾证据：超时、限流、企业版三原因互不相同且不用恒值（got ' + reasons.join(',') + '）')
}

// ---------- 4) 行为：坏节点只丢坏票 ----------
// 归一对纯 JSON 输入是全函数（不抛错），坏票只能来自宿主直接给的对象（如原型异常）。
// 这里用临时替换 JSON.parse 的办法，把坏对象（含抛错取值器）直接塞进列表输入，验证逐票丢弃与计数。
{
  const logs = []
  const good = (n) => ({ number: n, title: 'good ' + n, state: 'open', labels: [], user: { login: 'a' }, html_url: 'https://github.com/o/r/issues/' + n })
  const bad = {}
  Object.defineProperty(bad, 'number', { enumerable: true, get() { throw new Error('bad node') } })
  const prGood = { number: 493, title: 'pr', state: 'OPEN', body: '', url: 'https://github.com/o/r/pull/493', createdAt: '', updatedAt: '', closedAt: null, mergedAt: null, author: { login: 'a' }, assignees: { nodes: [] }, labels: { nodes: [] }, milestone: null, comments: { nodes: [] }, reviews: { nodes: [] } }
  const origParse = JSON.parse
  const ctx = {
    cwd: ROOT,
    platform: { resolveExecutable: async (n) => (n === 'gh' ? 'gh' : null), env: { get: () => '' } },
    exec: async (cmd, args) => {
      const joined = (args || []).join(' ')
      if (joined.includes('pullRequests')) return { code: 0, stdout: '__PR_GOOD__', stderr: '' }
      if (joined.includes('graphql')) return { code: 0, stdout: '__ISSUES_MIXED__', stderr: '' }
      return { code: 1, stdout: '', stderr: 'unexpected' }
    },
    logEvent: (level, event, fields) => { logs.push({ level, event, fields }) },
    isEnabled: (k) => k === 'debug',
  }
  JSON.parse = function (t) {
    if (t === '__ISSUES_MIXED__') return { data: { repository: { issues: { nodes: [good(1), bad, good(2)], pageInfo: { hasNextPage: false, endCursor: null } } } } }
    if (t === '__PR_GOOD__') return { data: { repository: { pullRequests: { nodes: [prGood], pageInfo: { hasNextPage: false, endCursor: null } } } } }
    return origParse(t)
  }
  let res = null
  try { res = await listIssues(repo, {}, ctx) } finally { JSON.parse = origParse }
  check(res && res.ok && res.data.length === 3, '坏节点：好票全保留（含拉取请求同池，got ' + (res && res.data && res.data.length) + '）')
  const hit = logs.find((l) => l.event === 'error.normalize' && String(l.fields && l.fields.rawKind || '').startsWith('bad-node:'))
  check(!!hit && hit.level === 'debug', '坏节点：复用调试事件记一行计数（got ' + JSON.stringify(hit && hit.fields) + '）')
  check(!logs.some((l) => l.event !== 'error.normalize' && l.event !== 'gh.exec'), '坏节点：主路成功时不落降级事件（只记计数）')
}

if (!process.exitCode) console.log('\nGREEN 全部通过 — #504 拉取请求专用探针就绪')
else console.log('\nRED 存在失败项')
