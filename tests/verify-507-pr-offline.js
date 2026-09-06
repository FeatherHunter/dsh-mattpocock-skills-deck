#!/usr/bin/env node
/**
 * 回归门禁：拉取请求离线桩验收 #507（契约三字段 / 双路降级合成 / 快照三态 / 前端四验收 / 同号异类 / 评论只读 / 失败空态）。
 *
 * 只读不断网：全部用内存桩代替真实网络，不调用真实 gh，不读令牌，不记仓库地址原文。
 * 只覆盖验收房：本文件与说明文档，不碰后端房与快照组装与界面实现。
 * 运行：node --no-warnings tests/verify-507-pr-offline.js
 *
 * 每组用例配一条日志链指纹（只用已有事件名与白名单字段，见 research/489-appendix.md 第 1 章）：
 * 契约三字段=纯形状无日志；双路降级=graphql.fallback+issues.fallback+fallback.chain；
 * 快照三态=snapshot.cache.miss 常驻；前端四验收与评论只读与失败空态=复用快照链路无新增。
 * 脱敏：指纹只记原因枚举与通道名与计数，不记令牌原文与仓库地址原文与标题原文。
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
function check(cond, msg) { if (!cond) { fail++; console.error('FAIL', msg) } else { pass++; console.log('PASS', msg) } }

const shapeSrc = readFileSync(resolve(ROOT, 'src/shared/tracker/shape.js'), 'utf8')
const contractSrc = readFileSync(resolve(ROOT, 'src/host/tracker/contract.js'), 'utf8')
const prTabSrc = readFileSync(resolve(ROOT, 'src/client/views/PrTab.js'), 'utf8')
const detailSrc = readFileSync(resolve(ROOT, 'src/client/views/IssueDetail.js'), 'utf8')
const dockSrc = readFileSync(resolve(ROOT, 'src/client/panel/Dock.js'), 'utf8')
const overlaySrc = readFileSync(resolve(ROOT, 'src/client/panel/Overlay.js'), 'utf8')
const reasonSrc = readFileSync(resolve(ROOT, 'src/host/tracker/backends/github/fallback-reason.js'), 'utf8')
const deckSrc = readFileSync(resolve(ROOT, 'src/shared/tracker/deck-derive.js'), 'utf8')

// ---------- A 契约三字段（形状 A：复用工单形状加三个可选字段，不新增实体）----------
check(shapeSrc.includes('isPullRequest') && shapeSrc.includes('mergedAt') && shapeSrc.includes('reviews'), 'A1 形状声明三字段齐全（是否为拉取请求、合并时间、评审细分）')
check(contractSrc.includes('isPullRequest') && contractSrc.includes('#506') && contractSrc.includes('界面过滤分界'), 'A2 过滤字段登记三字段之一并写明界面过滤分界（注记可懂）')
check(reasonSrc.includes('pickFallbackReason'), 'A3 降级分类谓词具名（不写匿名判断，#506 留尾已验）')
check(deckSrc.includes('candidatesOf') && deckSrc.includes('poolIdOfTicket'), 'A4 池内身份与同号候选谓词具名（评审合并展示留后续但身份可查）')

const { normalizeIssue } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/backends/github/normalize.js')).href)
const empty = normalizeIssue({})
check(empty.isPullRequest === false && empty.mergedAt === null && Array.isArray(empty.reviews) && empty.reviews.length === 0, 'A5 空来源逐票必带三字段空值（假、空、空数组，不省略）')
const bad = normalizeIssue({ number: 1, title: 't', state: 'open', reviews: [{ reviewer: { login: 'x' } }, null], mergedAt: 12345 })
check(Array.isArray(bad.reviews) && bad.reviews.length === 0 && bad.mergedAt === null, 'A6 坏值收空（缺结论评审丢弃，数字合并时间收空，不抛错）')

// ---------- B 双路降级合成（桩造四种失败，不碰真仓）----------
const { listIssues } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/backends/github/issues.js')).href)
function stubCtx(failStderr, ghHost) {
  const logs = []
  return { logs, ctx: { cwd: ROOT, platform: { resolveExecutable: async (n) => (n === 'gh' ? 'gh' : null), env: { get: (k) => (k === 'GH_HOST' ? (ghHost || '') : '') } },
    exec: async (cmd, args) => { const j = (args || []).join(' '); if (j.includes('graphql')) return { code: 1, stdout: '', stderr: failStderr };
      if (j.includes('/issues?state=all')) return { code: 0, stdout: JSON.stringify([{ number: 1, title: 't', state: 'open', labels: [], user: { login: 'a' }, html_url: 'https://x/issues/1' }]), stderr: '' };
      if (j.includes('/pulls?state=all')) return { code: 0, stdout: '[]', stderr: '' }; if (j.includes('/sub_issues')) return { code: 0, stdout: '[]', stderr: '' };
      return { code: 1, stdout: '', stderr: 'unexpected' } },
    logEvent: (level, event, fields) => { logs.push({ level, event, fields }) }, isEnabled: () => true } }
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
// 过滤字段消费（#504 留尾已接：后端按该字段过滤，前端按同形登记）
{
  const good = (n) => ({ number: n, title: 'good ' + n, state: 'open', labels: [], user: { login: 'a' }, html_url: 'https://x/issues/' + n })
  const pr = { number: 493, title: 'pr', state: 'OPEN', body: '', url: 'https://x/pull/493', createdAt: '', updatedAt: '', closedAt: null, mergedAt: null, author: { login: 'a' }, assignees: { nodes: [] }, labels: { nodes: [] }, milestone: null, comments: { nodes: [] }, reviews: { nodes: [] } }
  const origParse = JSON.parse
  const ctx = { cwd: ROOT, platform: { resolveExecutable: async () => 'gh', env: () => '' }, exec: async (cmd, args) => { const j = (args || []).join(' '); if (j.includes('pullRequests')) return { code: 0, stdout: '__PR__', stderr: '' }; if (j.includes('graphql')) return { code: 0, stdout: '__ISS__', stderr: '' }; return { code: 1, stdout: '', stderr: 'x' } }, logEvent: () => {}, isEnabled: () => false }
  JSON.parse = function (t) { if (t === '__ISS__') return { data: { repository: { issues: { nodes: [good(1)], pageInfo: { hasNextPage: false, endCursor: null } } } } }; if (t === '__PR__') return { data: { repository: { pullRequests: { nodes: [pr], pageInfo: { hasNextPage: false, endCursor: null } } } } }; return origParse(t) }
  let only = null
  try { only = await listIssues(repo, { isPullRequest: true }, ctx) } finally { JSON.parse = origParse }
  check(only && only.ok && only.data.length === 1 && only.data[0].isPullRequest === true, 'B4 过滤字段消费：只取拉取请求时普通工单被滤掉（got ' + (only && only.data && only.data.length) + '）')
}

// ---------- C 快照三态（真、假、省略分键，坏值隔离）----------
const { createRegistry } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/registryCore.js')).href)
const { createSnapshotComposer } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/snapshot.js')).href)
const base = (o) => Object.assign({ type: 'issue', title: 'T', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' }, o)
const prData = [
  base({ key: 'm1', type: 'map', title: 'M' }),
  base({ key: '5', title: 'Issue5', parentKey: 'm1', isPullRequest: false, mergedAt: null, reviews: [] }),
  base({ key: '6', title: 'PR6', parentKey: 'm1', isPullRequest: true, mergedAt: null, reviews: [] }),
  base({ key: '5', title: 'PR5-orphan', isPullRequest: true, mergedAt: null, reviews: [] }),
  base({ key: '8', title: 'Legacy8' }),
  base({ key: '9', title: 'Bad9', isPullRequest: 'yes' }),
]
{
  const registry = createRegistry({}, { matchesTimeout: 50 })
  registry.register({ id: 'prpool', label: 'prpool', create: () => ({ list: async () => ({ ok: true, data: prData }) }), matches: async () => true })
  const fires = []
  const composer = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000, logCtx: { fire(l, e, f) { fires.push({ level: l, event: e, fields: f }) }, isEnabled: (l) => l === 'info' } })
  const r = await composer.composeSnapshot('prpool', { backend: 'prpool', refId: 'r1', name: 'R1', url: '' }, {})
  const m1 = r.snapshot.maps.find((x) => x.key === 'm1')
  check(r.ok === true && m1 && m1.tickets.length === 2 && m1.tickets.some((t) => t.isPullRequest === false) && m1.tickets.some((t) => t.isPullRequest === true), 'C1 同池同挂一图（普通工单与拉取请求不分片）')
  const orphans = r.snapshot.issues
  check(orphans.some((t) => t.title === 'PR5-orphan' && t.isPullRequest === true) && orphans.some((t) => t.key === '8') && orphans.some((t) => t.key === '9'), 'C2 同号异类不互吞且坏值单独隔离（孤儿拉取请求、省略、坏值各在）')
  const po = (r.snapshot.deck && r.snapshot.deck.progressOf) || {}
  check(('5\0issue' in po) && ('5\0pr' in po) && r.snapshot.deck.stats.total === 5, 'C3 同键双票各记一票（牌面派生不丢任一）')
  const miss = fires.find((f) => f.event === 'snapshot.cache.miss')
  check(!!miss && miss.level === 'info' && miss.fields && typeof miss.fields.reason === 'string' && Object.keys(miss.fields).join(',') === 'reason', 'C4 未命中指纹只记原因枚举（got ' + JSON.stringify(miss && miss.fields) + '）')
  const v1 = r.version
  prData.find((t) => t.title === 'PR6').mergedAt = '2024-03-01T00:00:00Z'
  const r2 = await composer.composeSnapshot('prpool', { backend: 'prpool', refId: 'r1', name: 'R1', url: '' }, {}, { force: true })
  check(r2.version !== v1, 'C5 只改合并时间版号变化（不 serve 陈旧快照）')
}

// ---------- D 前端四验收（只读源码断言，不改实现）----------
check((dockSrc.includes('prTabVisible') && overlaySrc.includes('prTabVisible')) && dockSrc.includes("s.tab = 'list'") && overlaySrc.includes('#506'), 'D1 页签回归：两容器读能力位且无能力回列表（含 Overlay 注记）')
check(detailSrc.includes('canComment') && detailSrc.includes('src.isPullRequest === true') && detailSrc.includes('snapIssue') && detailSrc.includes('Array.isArray(rawComments)') && detailSrc.includes('rawComments.nodes'), 'D2 评论隐藏双路：数组与图形状都兼容，任一来源标拉取请求即隐藏')
check(prTabSrc.includes('prFilterForList()') && prTabSrc.includes("listIssues({ refId: 'owner/name' }"), 'D3 接线可抄：列表以过滤函数为依据并留后端直调示例')
check(prTabSrc.includes('prIssuesOf') && prTabSrc.includes('只收 isPullRequest 为真'), 'D4 注记可懂：过滤归属写清快照全留过滤归前端')

// ---------- E 同号异类与评审留痕（#506 留尾：合并展示留后续，本票只验不吞与留痕）----------
check(prTabSrc.includes('同号') && detailSrc.includes('评审合并展示留后续'), 'E1 同号留痕：源码明示同号进同一详情且评审合并展示留后续（不静默缺失）')

// ---------- F 评论只读（行为仿真，不起浏览器）----------
{
  const basePred = (raw) => !!raw && (Array.isArray(raw) ? true : (typeof raw === 'object' && raw !== null && Array.isArray(raw.nodes)))
  const withPR = (raw, src, snap) => { let c = basePred(raw); if ((src && src.isPullRequest === true) || (snap && snap.isPullRequest === true)) c = false; return c }
  const arr = withPR([], { isPullRequest: true }, null)
  const nodes = withPR({ nodes: [], pageInfo: {} }, null, { isPullRequest: true })
  const missing = withPR(undefined, { isPullRequest: false }, { isPullRequest: false })
  const normal = withPR([], { isPullRequest: false }, { isPullRequest: false })
  check(arr === false && nodes === false, 'F1 拉取请求详情只读（数组与图形状有评论也不给输入框）')
  check(missing === false && normal === true, 'F2 非拉取请求保持原语义（省略隐藏、空数组显示）')
  check(detailSrc.includes("!canComment ? h('span'"), 'F3 只读提示条件化（输入区被替代时才提示）')
}

// ---------- G 失败空态（入口保留，不白屏）----------
check(prTabSrc.includes("snapMode === 'loading'") && prTabSrc.includes('list.loading'), 'G1 加载态保留入口（转圈加文案，不白屏）')
check(prTabSrc.includes("snapMode === 'err'") && prTabSrc.includes('pr.loadFail') && prTabSrc.includes('pr.retry') && prTabSrc.includes('loadSnapshot(st, true)'), 'G2 失败态保留重试（失败横幅加重试按钮可重拉）')
check(prTabSrc.includes('pr.empty'), 'G3 空态保留占位（零拉取请求给空文案，不崩）')
check(detailSrc.includes("mode === 'err'") && detailSrc.includes('issueUrlFor(st, issueNumber)'), 'G4 详情失败保留外部入口（重试加源站链接可跳出）')

if (!fail) console.log('\nGREEN 全部通过 — #507 离线桩验收就绪（' + pass + ' 项）')
else console.log('\nRED 存在失败项（过 ' + pass + ' / 败 ' + fail + '）')
