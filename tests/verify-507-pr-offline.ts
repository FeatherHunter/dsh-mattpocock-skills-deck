#!/usr/bin/env node
/**
 * 回归门禁：拉取请求离线桩验收 #507（契约三字段空值 / 双路降级合成 / 快照三态）。
 *
 * 只读不断网：全部用内存桩代替真实网络，不调用真实 gh，不读令牌，不记仓库地址原文。
 * 运行：node --no-warnings tests/verify-507-pr-offline.js
 *
 * 2026-10-12 清理（维护者要求删掉「读源码文本钉形状」的断言）：
 *   这份文件原来还有一批「读 src 源码文本、断言某段字必须出现/不许出现」的断言
 *   （契约字段名在不在、界面接线写法、词条键名、加载态/失败态分支写法等，共 13 条）。
 *   它们会因为等价重构而变红，与产品行为无关，已按令删除；真正跑产品代码的断言一条没动：
 *   A5/A6 归一化空值与坏值收空、B1–B4 双路降级与过滤字段消费、C1–C5 快照三态与版号推进。
 *   F 组「评论只读」原来是本地重写一遍判据再断言自己——那不是产品行为，删源码文本断言后它已无意义，一并删除。
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// #1227 复判：gh 客户端要求 ctx.outbound 必填（#1159：缺了按环境失败、不发这一笔），
// 夹具补上宿主那一份，才能走到真实的 GraphQL 失败与 REST 降级分支。
import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
function check(cond: unknown, msg: string) { if (!cond) { fail++; console.error('FAIL', msg) } else { pass++; console.log('PASS', msg) } }

// ---------- A 契约三字段（形状 A：复用工单形状加三个可选字段，不新增实体）----------
const { normalizeIssue } = await import(pathToFileURL(resolve(ROOT, 'src/tracker/rooms/github/model/normalize.ts')).href)
// #1688 起「来源没表达」与「明确为空」分开：空来源不再逐票补三字段空值，坏值也不再收敛成空。
const empty = normalizeIssue({})
check(empty.isPullRequest === false && !('mergedAt' in empty) && !('reviews' in empty), 'A5 空来源不冒充「没有评审」「还没合并」（字段省略，三态记未表达）')
const bad = normalizeIssue({ number: 1, title: 't', state: 'open', reviews: [{ reviewer: { login: 'x' } }, null], mergedAt: 12345 })
check(Array.isArray(bad.reviews) && bad.reviews.length === 0 && !('mergedAt' in bad), 'A6 坏值不编事实（缺结论评审丢弃，数字合并时间记为读不懂并省略字段，不抛错）')

// ---------- B 双路降级合成（桩造四种失败，不碰真仓）----------
const { listIssues } = await import(pathToFileURL(resolve(ROOT, 'src/tracker/rooms/github/read/issues.ts')).href)
function stubCtx(failStderr: string, ghHost: string) {
  const logs: Array<{ level: string; event: string; fields: any }> = []
  return { logs, ctx: { outbound: createOutboundControl(), cwd: ROOT, platform: { resolveExecutable: async (n: string) => (n === 'gh' ? 'gh' : null), env: { get: (k: string) => (k === 'GH_HOST' ? (ghHost || '') : '') } },
    exec: async (cmd: unknown, args?: string[]) => { const j = (args || []).join(' '); if (j.includes('graphql')) return { code: 1, stdout: '', stderr: failStderr };
      if (j.includes('/issues?state=all')) return { code: 0, stdout: JSON.stringify([{ number: 1, title: 't', state: 'open', labels: [], user: { login: 'a' }, html_url: 'https://x/issues/1' }]), stderr: '' };
      if (j.includes('/pulls?state=all')) return { code: 0, stdout: '[]', stderr: '' }; if (j.includes('/sub_issues')) return { code: 0, stdout: '[]', stderr: '' };
      return { code: 1, stdout: '', stderr: 'unexpected' } },
    logEvent: (level: string, event: string, fields: any) => { logs.push({ level, event, fields }) }, isEnabled: () => true } }
}
const repo = { refId: 'o/r', name: 'o/r' }
const cases = [
  { name: '通用', stderr: 'Post "https://api.github.com/graphql": unexpected EOF', host: '', want: 'graphql-error' },
  { name: '超时', stderr: 'timeout after 30s', host: '', want: 'timeout' },
  { name: '限流', stderr: 'API rate limit exceeded (429)', host: '', want: 'rate-limit' },
  { name: '企业版', stderr: 'unexpected EOF', host: 'ghe.example.com', want: 'ghe-host' },
]
let reasonsOk = true
let chainOk = true
for (const c of cases) {
  const { logs, ctx } = stubCtx(c.stderr, c.host)
  const res = await listIssues(repo, {}, ctx)
  const fb = logs.find((l) => l.event === 'graphql.fallback')
  const ch = logs.find((l) => l.event === 'fallback.chain')
  const fb2 = logs.find((l) => l.event === 'issues.fallback')
  if (!(res && res.ok === true)) reasonsOk = false
  if (!(fb && fb.fields && fb.fields.reason === c.want)) reasonsOk = false
  if (!(fb2 && fb2.fields && fb2.fields.from === 'graphql' && fb2.fields.to === 'rest')) reasonsOk = false
  if (!(ch && ch.fields && typeof ch.fields.latencyMs === 'number' && ch.fields.in === 'graphql' && ch.fields.out === 'rest')) chainOk = false
}
check(reasonsOk, 'B1 四种失败各走各的原因且回退到 REST（超时、限流、企业版、通用）')
check(chainOk, 'B2 合成链指纹含耗时毫秒（fallback.chain 记 in/out/latencyMs，只记通道名）')
{
  const { logs, ctx } = stubCtx('timeout after 30s', '')
  await listIssues(repo, {}, ctx)
  const blob = JSON.stringify(logs.map((l) => l.fields))
  check(!blob.includes('gho_') && !blob.includes('github_pat_') && !blob.includes('bearer ') && !blob.includes('C:\\'), 'B3 降级指纹脱敏（无令牌原文与路径原文，只记枚举与通道名）')
}
// 过滤字段消费（#504 留尾已接：后端按该字段过滤）
{
  const good = (n: number) => ({ number: n, title: 'good ' + n, state: 'open', labels: [], user: { login: 'a' }, html_url: 'https://x/issues/' + n })
  const pr = { number: 493, title: 'pr', state: 'OPEN', body: '', url: 'https://x/pull/493', createdAt: '', updatedAt: '', closedAt: null, mergedAt: null, author: { login: 'a' }, assignees: { nodes: [] }, labels: { nodes: [] }, milestone: null, comments: { nodes: [] }, reviews: { nodes: [] } }
  const origParse = JSON.parse
  const ctx = { cwd: ROOT, outbound: createOutboundControl(), platform: { resolveExecutable: async () => 'gh', env: () => '' }, exec: async (cmd: unknown, args?: string[]) => { const j = (args || []).join(' '); if (j.includes('pullRequests')) return { code: 0, stdout: '__PR__', stderr: '' }; if (j.includes('graphql')) return { code: 0, stdout: '__ISS__', stderr: '' }; return { code: 1, stdout: '', stderr: 'x' } }, logEvent: () => {}, isEnabled: () => false }
  JSON.parse = function (t: string) { if (t === '__ISS__') return { data: { repository: { issues: { nodes: [good(1)], pageInfo: { hasNextPage: false, endCursor: null } } } } }; if (t === '__PR__') return { data: { repository: { pullRequests: { nodes: [pr], pageInfo: { hasNextPage: false, endCursor: null } } } } }; return origParse(t) }
  let only = null
  try { only = await listIssues(repo, { isPullRequest: true }, ctx) } finally { JSON.parse = origParse }
  check(only && only.ok && only.data.length === 1 && only.data[0].isPullRequest === true, 'B4 过滤字段消费：只取拉取请求时普通工单被滤掉（got ' + (only && only.data && only.data.length) + '）')
}

// ---------- C 快照三态（真、假、省略分键，坏值隔离）----------
const { createRegistry } = await import(pathToFileURL(resolve(ROOT, 'src/tracker/registry/core.ts')).href)
const { createSnapshotComposer } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/snapshot.js')).href)
const base = (o: Record<string, unknown>) => Object.assign({ type: 'issue', title: 'T', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' }, o)
const prData: Array<Record<string, any>> = [
  base({ key: 'm1', type: 'map', title: 'M' }),
  base({ key: '5', title: 'Issue5', parentKey: 'm1', isPullRequest: false, mergedAt: null, reviews: [] }),
  base({ key: '6', title: 'PR6', parentKey: 'm1', isPullRequest: true, mergedAt: null, reviews: [] }),
  base({ key: '5', title: 'PR5-orphan', isPullRequest: true, mergedAt: null, reviews: [] }),
  base({ key: '8', title: 'Legacy8' }),
  base({ key: '9', title: 'Bad9', isPullRequest: 'yes' }),
]
{
  const registry = createRegistry({}, { matchesTimeout: 50 })
  // 预算声明是登记口的必填格（#1439）：这是离线内存桩，不碰网络，所以按 off-network 报。
  registry.register({ id: 'prpool', label: 'prpool', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => ({ list: async () => ({ ok: true, data: prData }) }), matches: async () => true })
  const fires: Array<{ level: string; event: string; fields: any }> = []
  const composer = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000, logCtx: { fire(l: string, e: string, f: any) { fires.push({ level: l, event: e, fields: f }) }, isEnabled: (l: string) => l === 'info' } })
  const r = await composer.composeSnapshot('prpool', { backend: 'prpool', refId: 'r1', name: 'R1', url: '' }, {})
  const m1 = r.snapshot.maps.find((x: { key: string }) => x.key === 'm1')
  check(r.ok === true && m1 && m1.tickets.length === 2 && m1.tickets.some((t: { isPullRequest: boolean }) => t.isPullRequest === false) && m1.tickets.some((t: { isPullRequest: boolean }) => t.isPullRequest === true), 'C1 同池同挂一图（普通工单与拉取请求不分片）')
  const orphans = r.snapshot.issues
  check(orphans.some((t: { title: string; isPullRequest: boolean }) => t.title === 'PR5-orphan' && t.isPullRequest === true) && orphans.some((t: { key: string }) => t.key === '8') && orphans.some((t: { key: string }) => t.key === '9'), 'C2 同号异类不互吞且坏值单独隔离（孤儿拉取请求、省略、坏值各在）')
  const po = (r.snapshot.deck && r.snapshot.deck.progressOf) || {}
  check(('5\0issue' in po) && ('5\0pr' in po) && r.snapshot.deck.stats.total === 5, 'C3 同键双票各记一票（牌面派生不丢任一）')
  const miss = fires.find((f) => f.event === 'snapshot.cache.miss')
  check(!!miss && miss.level === 'info' && miss.fields && typeof miss.fields.reason === 'string' && Object.keys(miss.fields).join(',') === 'reason', 'C4 未命中指纹只记原因枚举（got ' + JSON.stringify(miss && miss.fields) + '）')
  const v1 = r.version
  prData.find((t) => t.title === 'PR6')!.mergedAt = '2024-03-01T00:00:00Z'
  const r2 = await composer.composeSnapshot('prpool', { backend: 'prpool', refId: 'r1', name: 'R1', url: '' }, {}, { force: true })
  check(r2.version !== v1, 'C5 只改合并时间版号变化（不 serve 陈旧快照）')
}

if (!fail) console.log('\nGREEN 全部通过 — #507 离线桩验收就绪（' + pass + ' 项）')
else console.log('\nRED 存在失败项（过 ' + pass + ' / 败 ' + fail + '）')
process.exit(fail ? 1 : 0)
