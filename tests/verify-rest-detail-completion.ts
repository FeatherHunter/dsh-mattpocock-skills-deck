#!/usr/bin/env node
/**
 * 门禁：REST 单票降级时按需补齐关系与明细（票 #1691，规格 #1681 阶段 4）。
 *
 * 现场：GraphQL 失败后单票读走 REST，`/issues/<n>` 只保证行与正文；评论正文、依赖边、
 * 拉取请求的评审与合并时间都不在这份回包里。本门禁拿 #1682 的真机夹具行当输入，跑真实的
 * getIssue 降级路径，断言：
 *  1. 每类明细最多发一次请求：评论、依赖、评审、合并时间各一次，父票边读回包不发请求；
 *  2. 补到的写回行上、来源完整度随之声明；补不到的写行内三态记「未知」，绝不写空数组；
 *  3. 行里没出现父票链接时记「未表达」，不是「明确没有父票」；
 *  4. 降级结果经 mergeSnapshot 合并进已知快照时，没表达的关系一条不减少（父子边、依赖边、
 *     评论、评审、合并时间、正文）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-rest-detail-completion.ts
 */
// 门禁归属: src/tracker/rooms/github/read/rest-detail-completion.ts
// 门禁归属: src/tracker/rooms/github/read/issues.ts
// 门禁归属: src/tracker/rooms/github/routing/read-assembly.ts
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-rest-detail-completion'

let total = 0
let failed = 0
function check(cond: unknown, label: string): void {
  total += 1
  if (cond) { console.log('  PASS ' + label); return }
  failed += 1
  console.log('  FAIL ' + label)
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) }

/** 读 #1682 的真机夹具行（脱敏后的两页样本，字段形状原样保留）。 */
const fixtures = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/1682/rest-list-with-fields.json'), 'utf8')).rows as any[]
function fixtureRow(n: number): any {
  const row = fixtures.find((r: any) => r.number === n)
  if (!row) throw new Error('夹具里没有 ' + n)
  return clone(row)
}

const { getIssue } = await import(pathToFileURL(resolve(ROOT, 'src/tracker/rooms/github/read/issues.ts')).href)
const { createOutboundControl } = await import(pathToFileURL(resolve(ROOT, 'src/refresh/rooms/host/outbound-control.ts')).href)
const merge = await import(pathToFileURL(resolve(ROOT, 'src/refresh/kernel/snapshot-merge.ts')).href)

const repo = { refId: 'example/repo', name: 'example/repo' }

/**
 * 造一个 GraphQL 恒失败、REST 按路由回答的假世界。
 * rows 是单票回包（按票号）；deps/comments/reviews/pulls 各自按票号给回包，给 null 表示这一笔失败。
 */
function makeWorld(opts: {
  rows: Record<string, any>
  deps?: Record<string, any[] | null>
  comments?: Record<string, any[] | null>
  reviews?: Record<string, any[] | null>
  pulls?: Record<string, any | null>
}) {
  const world: any = { calls: [] as string[], hits: { issues: 0, deps: 0, comments: 0, reviews: 0, pulls: 0 }, ctx: null }
  function route(joined: string): any {
    if (joined.includes('graphql')) return { code: 1, stdout: '', stderr: 'Post "https://api.github.com/graphql": unexpected EOF' }
    let m = /\/issues\/(\d+)\/dependencies\/blocked_by/.exec(joined)
    if (m) {
      world.hits.deps += 1
      const body = opts.deps ? opts.deps[m[1]] : undefined
      if (body === undefined || body === null) return { code: 1, stdout: '', stderr: 'HTTP 500' }
      return { code: 0, stdout: JSON.stringify(body), stderr: '' }
    }
    m = /\/issues\/(\d+)\/comments/.exec(joined)
    if (m) {
      world.hits.comments += 1
      const body = opts.comments ? opts.comments[m[1]] : undefined
      if (body === undefined || body === null) return { code: 1, stdout: '', stderr: 'HTTP 500' }
      return { code: 0, stdout: JSON.stringify(body), stderr: '' }
    }
    m = /\/pulls\/(\d+)\/reviews/.exec(joined)
    if (m) {
      world.hits.reviews += 1
      const body = opts.reviews ? opts.reviews[m[1]] : undefined
      if (body === undefined || body === null) return { code: 1, stdout: '', stderr: 'HTTP 500' }
      return { code: 0, stdout: JSON.stringify(body), stderr: '' }
    }
    m = /\/pulls\/(\d+)$/.exec(joined)
    if (m) {
      world.hits.pulls += 1
      const body = opts.pulls ? opts.pulls[m[1]] : undefined
      if (body === undefined || body === null) return { code: 1, stdout: '', stderr: 'HTTP 500' }
      return { code: 0, stdout: JSON.stringify(body), stderr: '' }
    }
    m = /\/issues\/(\d+)$/.exec(joined)
    if (m) {
      world.hits.issues += 1
      const body = opts.rows[m[1]]
      if (body === undefined) return { code: 1, stdout: '', stderr: 'HTTP 404' }
      return { code: 0, stdout: JSON.stringify(body), stderr: '' }
    }
    if (joined.includes('/pulls?state=all')) return { code: 0, stdout: '[]', stderr: '' }
    return { code: 1, stdout: '', stderr: 'unexpected args: ' + joined }
  }
  world.ctx = {
    cwd: ROOT,
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async (name: string) => (name === 'gh' ? 'gh' : null) },
    exec: async function (cmd: string, args: string[]) {
      const joined = (args || []).join(' ')
      world.calls.push(joined)
      return route(joined)
    },
  }
  return world
}

function keysOf(refs: any[] | undefined): string {
  return (refs || []).map((r: any) => String(r.key)).join(',')
}

// ---------- 1. 工单详情：父边读回包零请求、依赖逐票一次、评论按需一次 ----------
console.log('工单详情：父边零请求、依赖与评论各一次')
const issue1700 = fixtureRow(1700)
issue1700.body = '# 正文\n这是一段正文。'
const w1 = makeWorld({
  rows: { '1700': issue1700 },
  deps: { '1700': [{ number: 301, title: '依赖 301', state: 'closed' }, { number: 302, title: '依赖 302', state: 'open' }, { number: 303, title: '依赖 303', state: 'open' }] },
  comments: { '1700': [{ id: 1, user: { login: 'u1' }, body: '第一条评论', created_at: '2026-10-01T00:00:00Z' }, { id: 2, user: { login: 'u2' }, body: '第二条评论', created_at: '2026-10-02T00:00:00Z' }] },
})
const g1 = await getIssue(repo, '1700', { comments: { first: 50 } }, w1.ctx)
check(g1 && g1.ok === true, 'REST 降级读单票成功')
check(w1.hits.issues === 1, '单票 /issues 只请求一次（got ' + w1.hits.issues + '）')
check(w1.hits.deps === 1, '依赖明细恰好请求一次（got ' + w1.hits.deps + '）')
check(w1.hits.comments === 1, '评论正文恰好请求一次（got ' + w1.hits.comments + '）')
check(w1.hits.reviews === 0 && w1.hits.pulls === 0, '工单详情不请求评审与合并时间（got ' + w1.hits.reviews + '/' + w1.hits.pulls + '）')

const d1 = g1.data
check(d1.parentKey === '1681', '父票边从回包的 parent_issue_url 补出（got ' + d1.parentKey + '）')
check(d1.fieldStates.parents.known === true && d1.fieldStates.parents.value === '1681', '父边行内三态记已知')
check(d1.fieldStates.dependencies.known === true && keysOf(d1.blockedBy) === '301,302,303', '依赖边补齐三条（got ' + keysOf(d1.blockedBy) + '）')
check(d1.fieldStates.subIssues.known === true && d1.fieldStates.subIssues.value.total === 0, '子票计数来自回包的 sub_issues_summary')
check((d1.comments || []).length === 2 && d1.comments[1].body === '第二条评论', '评论正文补回两条（got ' + (d1.comments || []).length + '）')
check(d1.commentCount === 2, '评论页不满一页：总数可证为 2（got ' + d1.commentCount + '）')
const p1 = g1.provenance
check(p1.source === 'rest' && p1.degradedFrom === 'graphql', '来源仍记 REST、降级来源 GraphQL')
check(p1.fieldGroups.parents === 'complete', '父边组声明「完整」（行内链接表达了）')
check(p1.fieldGroups.dependencies === 'complete', '依赖组声明「完整」（明细已核对）')
check(p1.fieldGroups.comments === 'complete', '评论组声明「完整」（不满一页即全部）')
check(p1.fieldGroups.review === 'unexpressed', '工单没有评审：评审组保持未表达')
check(p1.fieldGroups.mergeInfo === 'unexpressed', '工单没有合并时间：合并时间组保持未表达')

// ---------- 2. 调用方没点名要评论：不发评论请求 ----------
console.log('没点名要评论：不补评论正文')
const issue1677 = fixtureRow(1677)
issue1677.body = '旧正文'
const w2 = makeWorld({
  rows: { '1677': issue1677 },
  deps: { '1677': [] },
})
const g2 = await getIssue(repo, '1677', undefined, w2.ctx)
check(g2 && g2.ok === true, '不点名要评论时降级读照样成功')
check(w2.hits.comments === 0, '调用方没要评论时不发评论请求（got ' + w2.hits.comments + '）')
check(w2.hits.deps === 1, '依赖摘要四格有大于零的格（total_blocked_by=3）时仍拉一次明细核对（got ' + w2.hits.deps + '）')
check(g2.data.fieldStates.dependencies.known === true && (g2.data.blockedBy || []).length === 0, '明细核对为零：记已知空数组（不是未知）')
check(g2.provenance.fieldGroups.comments === 'unexpressed', '没补评论：评论组保持未表达')
check(g2.provenance.fieldGroups.parents === 'complete', '父边仍从行内链接补出（got ' + g2.provenance.fieldGroups.parents + '）')

// ---------- 2b. 评论页正好满一页：正文补到了，总数仍保持未知 ----------
console.log('评论页满一页：总数保持未知')
const issue1699 = fixtureRow(1699)
const w2b = makeWorld({
  rows: { '1699': issue1699 },
  deps: { '1699': [{ number: 311, title: '依赖 311', state: 'open' }] },
  comments: { '1699': [{ id: 9, user: { login: 'u9' }, body: '只有这一条', created_at: '2026-10-01T00:00:00Z' }] },
})
const g2b = await getIssue(repo, '1699', { comments: { first: 1 } }, w2b.ctx)
check(g2b && g2b.ok === true, '要一条评论时降级读成功')
check(w2b.hits.comments === 1, '评论请求恰好一次（got ' + w2b.hits.comments + '）')
check((g2b.data.comments || []).length === 1, '评论正文补回一条')
check(g2b.data.commentCount === undefined, '满一页时后面的评论可能还有：总数保持未知，不拿正文条数顶替')
check(g2b.provenance.fieldGroups.comments === 'truncated', '满一页的评论组声明「截断」（got ' + g2b.provenance.fieldGroups.comments + '）')

// ---------- 3. 拉取请求详情：评审与合并时间各一次请求 ----------
console.log('拉取请求详情：评审与合并时间各一次')
const pr1622 = fixtureRow(1622)
const w3 = makeWorld({
  rows: { '1622': pr1622 },
  reviews: { '1622': [{ state: 'APPROVED', user: { login: 'rev' }, submitted_at: '2026-10-03T00:00:00Z' }] },
  pulls: { '1622': { number: 1622, merged_at: '2026-10-04T00:00:00Z' } },
})
const g3 = await getIssue(repo, '1622', undefined, w3.ctx)
check(g3 && g3.ok === true, 'REST 降级读拉取请求成功')
check(w3.hits.issues === 1 && w3.hits.reviews === 1 && w3.hits.pulls === 1, '单票 /issues、评审、合并时间各一次（got ' + w3.hits.issues + '/' + w3.hits.reviews + '/' + w3.hits.pulls + '）')
check(w3.hits.deps === 0 && w3.hits.comments === 0, '拉取请求不拉工单依赖与评论（got ' + w3.hits.deps + '/' + w3.hits.comments + '）')
check(g3.data.isPullRequest === true, '归一出拉取请求标记')
check((g3.data.reviews || []).length === 1 && g3.data.reviews[0].state === 'APPROVED', '评审明细补齐一条（got ' + (g3.data.reviews || []).length + '）')
check(g3.data.mergedAt === '2026-10-04T00:00:00Z', '合并时间补齐（got ' + g3.data.mergedAt + '）')
check(g3.data.fieldStates.parents.reason === 'not-applicable', '拉取请求的父子关系记「不适用」')
check(g3.data.fieldStates.dependencies.reason === 'not-applicable', '拉取请求的依赖关系记「不适用」')
check(g3.provenance.fieldGroups.review === 'complete', '评审组声明「完整」（不满一页）')
check(g3.provenance.fieldGroups.mergeInfo === 'complete', '合并时间组声明「完整」')

// ---------- 4. 负例一：补不到记未知，不写空数组 ----------
console.log('负例：补不到记未知')
const issue1700b = fixtureRow(1700)
const w4 = makeWorld({ rows: { '1700': issue1700b }, deps: { '1700': null } })
const g4 = await getIssue(repo, '1700', undefined, w4.ctx)
check(g4 && g4.ok === true, '依赖明细失败时单票读仍成功（不把整票读失败）')
check(g4.data.fieldStates.dependencies.known === false && g4.data.fieldStates.dependencies.reason === 'unreadable', '依赖明细失败：行内三态记未知/读不懂')
check(g4.data.blockedBy === undefined, '依赖明细失败不写空数组冒充「没有依赖」')
check(g4.provenance.fieldGroups.dependencies === 'unexpressed', '依赖明细失败：来源完整度保持未表达')

const pr1587 = fixtureRow(1587)
const w5 = makeWorld({ rows: { '1587': pr1587 }, reviews: { '1587': null }, pulls: { '1587': { number: 1587, merged_at: null } } })
const g5 = await getIssue(repo, '1587', undefined, w5.ctx)
check(g5 && g5.ok === true, '评审请求失败时拉取请求读仍成功')
check(g5.data.fieldStates.review.known === false && g5.data.fieldStates.review.reason === 'unreadable', '评审补不到：记未知，不写空评审')
check(g5.data.reviews === undefined, '评审补不到时不写空数组冒充「没有评审」')
check(g5.provenance.fieldGroups.review === 'unexpressed', '评审补不到：来源完整度保持未表达')
check(g5.data.mergedAt === null && g5.provenance.fieldGroups.mergeInfo === 'complete', '合并时间明确为 null 是「还没合并」的事实，记完整')

// ---------- 5. 负例二：行里没有父票链接 → 未表达，不是明确没有父票 ----------
console.log('负例：父票链接缺失')
const issue1681 = fixtureRow(1681)
delete issue1681.parent_issue_url
delete issue1681.issue_dependencies_summary
const w6 = makeWorld({ rows: { '1681': issue1681 }, deps: { '1681': null } })
const g6 = await getIssue(repo, '1681', undefined, w6.ctx)
check(g6 && g6.ok === true, '父票链接缺失时仍能读出单票')
check(g6.data.fieldStates.parents.known === false && g6.data.fieldStates.parents.reason === 'not-expressed', '父票链接缺失：父边记「未表达」')
check(g6.provenance.fieldGroups.parents === 'unexpressed', '父票链接缺失：来源完整度不声明完整')
check(g6.data.fieldStates.dependencies.known === false, '依赖摘要缺失且明细失败：依赖记未知（不是零）')

// ---------- 6. 降级结果合并进已知快照：没表达的关系一条不减少 ----------
console.log('降级合并：没表达的关系不减少')
const CLOCK0 = 1700000000000
function oldRow(n: number, extra: any): any {
  return Object.assign({
    number: n, key: String(n), title: '旧标题 ' + n, state: 'OPEN',
    updatedAt: '2026-09-20T00:00:00Z', createdAt: '2026-09-01T00:00:00Z',
    labels: [], assignees: [],
  }, extra)
}
const old1681 = oldRow(1681, {
  body: '旧正文', parentKey: '1000',
  blockedBy: [{ key: '901', title: '旧依赖 901', state: 'OPEN' }],
  subIssueCounts: { total: 1, completed: 0, percentCompleted: 0 },
  comments: [{ body: '旧评论' }], commentCount: 1,
  reviews: [{ state: 'CHANGES_REQUESTED' }], mergedAt: '2026-01-01T00:00:00Z',
})
const snapshot = {
  version: 'v0',
  issues: [old1681],
  maps: [],
  deck: { counts: { open: 1, closed: 0, total: 1 }, partial: false, levels: [] },
  delta: { structureVersion: 1, watermarkMs: CLOCK0 - 3600000, generation: 3, pending: [] },
  merge: { version: 5, lastStartMs: CLOCK0 - 5000, groups: {} },
}
const g6b = await getIssue(repo, '1681', undefined, w6.ctx)
const d6 = g6b.data
// 人工按宿主薄行（thin-row-fetch.rowOf）的形状把读结果装成一行：只挂行内三态说 known 的组。
const row6: any = {
  number: Number(d6.key), key: String(d6.key), title: d6.title, state: d6.state === 'closed' ? 'CLOSED' : 'OPEN',
  updatedAt: d6.updatedAt, createdAt: d6.createdAt, labels: [], assignees: [],
  provenance: g6b.provenance,
}
if (d6.body !== undefined) row6.body = '新正文'
const st6 = d6.fieldStates
if (st6) {
  if (st6.parents && st6.parents.known === true) row6.parentKey = st6.parents.value
  if (st6.dependencies && st6.dependencies.known === true) row6.blockedBy = st6.dependencies.value
  if (st6.subIssues && st6.subIssues.known === true) row6.subIssueCounts = st6.subIssues.value
  if (st6.comments && st6.comments.known === true) { row6.comments = d6.comments || []; row6.commentCount = st6.comments.value }
  if (st6.review && st6.review.known === true) row6.reviews = st6.review.value
  if (st6.mergeInfo && st6.mergeInfo.known === true) row6.mergedAt = st6.mergeInfo.value
  row6.fieldStates = st6
}
const merged = merge.mergeSnapshot(snapshot, {
  kind: 'read', startMergeVersion: 5, startedMs: CLOCK0, rows: [row6], allowNewRows: false,
})
check(merged.verdict === 'merged', '降级读结果被合并服务接受（got ' + merged.verdict + '）')
check(merged.merge.version === 6, '合并版本单调加一（got ' + merged.merge.version + '）')
const m1681 = (merged.snapshot.issues || []).find((r: any) => String(r.key) === '1681')
check(!!m1681 && m1681.parentKey === '1000', '父边未表达：旧父票边保留（got ' + (m1681 && m1681.parentKey) + '）')
check(!!m1681 && keysOf(m1681.blockedBy) === '901', '依赖未表达：旧依赖边保留（got ' + keysOf(m1681 && m1681.blockedBy) + '）')
check(!!m1681 && (m1681.comments || []).length === 1 && m1681.commentCount === 1, '评论未表达：旧评论与总数保留')
check(!!m1681 && (m1681.reviews || []).length === 1 && m1681.reviews[0].state === 'CHANGES_REQUESTED', '评审未表达：旧评审保留')
check(!!m1681 && m1681.mergedAt === '2026-01-01T00:00:00Z', '合并时间未表达：旧值保留')
check(!!m1681 && JSON.stringify(m1681.subIssueCounts) === JSON.stringify({ total: 19, completed: 0, percentCompleted: 0 }), '子票计数已表达：换成新摘要（19）')
check(!!m1681 && m1681.body === '新正文', '正文完整：换成新正文')
check(merged.changes.updated.indexOf('1681') >= 0, '改动的那一行计入 updated')

printGateResult(GATE, total, failed ? 1 : 0)
process.exit(failed ? 1 : 0)
