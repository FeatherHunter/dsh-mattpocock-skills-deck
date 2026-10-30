#!/usr/bin/env node
/**
 * 回归门禁：GitHub 后端 list/get 的 REST 降级（#415 承接 #414 刷新现场）。
 *
 * 背景：2026-09-02 现场实测 —— api.github.com/graphql 的 POST 在本机偶发
 * `unexpected EOF`（网络层），而 REST 单页稳定（gh api repos/.../issues?page=k）。
 * 面板刷新（wf.refresh → composer → listIssues(GraphQL)）因此失败，
 * 客户端静默保留旧快照 → 列表不出现 414、状态栏时间却走针。
 *
 * 本测试走行为断言：stub ctx（GraphQL 恒失败 / REST 恒成功），listIssues 必须经 REST 返回
 * 全量并修复树边（子票 parentKey 指向 wayfinder:map 地图票），getIssue 同样可用。
 *
 * 运行：node --no-warnings tests/verify-github-rest-fallback.ts
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function check (cond, msg) { if (!cond) { console.error('FAIL', msg); process.exitCode = 1 } else console.log('PASS', msg) }

// ---------- 行为断言（stub 双路）----------
const { listIssues, getIssue } = await import(pathToFileURL(resolve(ROOT, 'src/tracker/rooms/github/issues.ts')).href)

// 固定夹具：150 条（page1=100, page2=50），其中 #1 为 wayfinder:map 地图；#7 为地图（有子票 414、8）；#414 在 page2
function makeIssue (n) {
  const labels = n === 1 || n === 7 ? [{ name: 'wayfinder:map' }] : [{ name: 'bug' }]
  return { number: n, title: 'issue ' + n, state: 'open', labels, user: { login: 'tester' }, html_url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/' + n }
}
const all = []
for (let n = 1; n <= 149; n++) all.push(makeIssue(n))
all.push(makeIssue(414)) // 外部建票 414（模拟现场：它在第 2 页）

// 2026-10-17（转 .ts 前先修）：出站控制面改成必填之后，夹具只给 platform/exec 会被挡在门口
//   （「出站控制面没有接上」，9 条断言全红）。按生产同一形状补上 ctx.outbound：装配点造房那一处
//   走 platformChannel 的 backendCtxForRooms、当次操作走 ctx.outbound，门禁夹具走后者。
//   名额闸给足、取消判定恒 false、搭车账本照记——这几条替身只为了让请求真的发出去。
const { createOutboundControl } = await import(pathToFileURL(resolve(ROOT, 'src/refresh/rooms/host/outbound-control.ts')).href)

const ctx = {
  cwd: ROOT,
  outbound: createOutboundControl(),
  platform: { resolveExecutable: async (name) => name === 'gh' ? 'gh' : null },
  exec: async function (cmd, args, opts) {
    const joined = (args || []).join(' ')
    if (joined.includes('graphql')) {
      // 模拟本机现场：GraphQL POST 必 EOF
      return { code: 1, stdout: '', stderr: 'Post "https://api.github.com/graphql": unexpected EOF' }
    }
    const page = /[?&]page=(\d+)/.exec(joined)
    if (joined.includes('/issues?state=all')) {
      const p = page ? Number(page[1]) : 1
      const start = (p - 1) * 100
      const slice = all.slice(start, start + 100)
      return { code: 0, stdout: JSON.stringify(slice), stderr: '' }
    }
    const sub = /issues\/(\d+)\/sub_issues/.exec(joined)
    if (sub) {
      const m = Number(sub[1])
      const kids = m === 7 ? [414, 8] : []
      return { code: 0, stdout: JSON.stringify(kids.map((n) => ({ number: n, title: 'child ' + n, state: 'open' }))), stderr: '' }
    }
    const single = /repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(joined)
    if (single) {
      const n = Number(single[1])
      const it = all.find((x) => x.number === n)
      return it ? { code: 0, stdout: JSON.stringify(it), stderr: '' } : { code: 1, stdout: '', stderr: 'HTTP 404' }
    }
    return { code: 1, stdout: '', stderr: 'unexpected args: ' + joined }
  },
}

const repo = { refId: 'FeatherHunter/dsh-mattpocock-skills-deck', name: 'FeatherHunter/dsh-mattpocock-skills-deck' }

const lr = await listIssues(repo, {}, ctx)
check(lr && lr.ok === true, 'listIssues: GraphQL 失败后 REST 降级成功')
if (lr && lr.ok) {
  const data = lr.data || []
  check(data.length === 150, 'listIssues: REST 全量 150 条（got ' + data.length + '）')
  const i414 = data.find((x) => String(x.key) === '414')
  check(!!i414, 'listIssues: 返回含 414')
  check(i414 && i414.parentKey === '7', 'listIssues: 414 树边修复 parentKey=7（got ' + (i414 && i414.parentKey) + '）')
  check(i414 && i414.url === 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/414', 'listIssues: 414 url 为页面地址（REST html_url 优先，got ' + (i414 && i414.url) + '）')
  const i8 = data.find((x) => String(x.key) === '8')
  check(i8 && i8.parentKey === '7', 'listIssues: 8 树边修复 parentKey=7')
  const m7 = data.find((x) => String(x.key) === '7')
  check(m7 && m7.type === 'map', 'listIssues: 地图票 #7 type=map（REST labels 推断）')
  const f = await listIssues(repo, { state: 'open', parentKey: '7' }, ctx)
  check(f && f.ok && f.data.length === 2, 'listIssues: 过滤 parentKey=7 得 2 条')
} else {
  console.error('listIssues result:', JSON.stringify(lr))
}

const gr = await getIssue(repo, '414', {}, ctx)
check(gr && gr.ok === true && gr.data && String(gr.data.key) === '414', 'getIssue: GraphQL 失败后 REST 降级成功（got ' + JSON.stringify(gr && gr.error ? gr.error : (gr && gr.data && gr.data.key)) + '）')

// ---------- #1682：REST 列表行的父票、依赖摘要、子票摘要（真机夹具）----------
// 2026-10-31 真机只读探针（两页 200 行）确认三个字段的实际形状；这里把「字段有」与「字段无」
// 两套脱敏夹具都跑一遍：有字段时按行解析出父票编号、四组依赖计数、三格子票计数；没有字段时
// 解析器必须说「不知道」并把上次已知交回调用方，不能把缺字段当成「没有父票 / 计数为零」。
// 夹具是静态文件，这一段不发任何网络请求。
const {
  detectRestListFieldPresence,
  parseRestListRowMetadata,
  chooseParentKey,
  chooseDependenciesSummary,
  chooseSubIssuesSummary,
  needsDependencyDetail,
} = await import(pathToFileURL(resolve(ROOT, 'src/tracker/rooms/github/channels/rest/list-row-metadata.ts')).href)

function loadFixture (name) {
  return JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/1682', name), 'utf8'))
}
function rowOf (rows, n) { return rows.find((r) => r.number === n) }
function metaOf (rows, n, presence) { return parseRestListRowMetadata(rowOf(rows, n), presence) }

const withFields = loadFixture('rest-list-with-fields.json')
const withoutFields = loadFixture('rest-list-without-fields.json')
const probe = loadFixture('probe-metadata.json')
const withPresence = detectRestListFieldPresence(withFields.rows)
const withoutPresence = detectRestListFieldPresence(withoutFields.rows)

check(probe.sampledAt === '2026-10-31T03:04:23+08:00', '探针夹具记着现场时间（got ' + probe.sampledAt + '）')
check(probe.rowsObserved === 200 && probe.issuesObserved === 187 && probe.pullRequestsObserved === 13,
  '探针覆盖两页 200 行（187 工单 + 13 拉取请求），与现场统计一致')
check(probe.repositoryScale && probe.repositoryScale.rows === 1691,
  '探针记下仓库规模（1627 工单 + 64 拉取请求，got ' + JSON.stringify(probe.repositoryScale) + '）')
check(probe.tailPageFailure && probe.tailPageFailure.exitCode === 1 && probe.tailPageFailure.stdoutBytes === 0 &&
  probe.tailPageFailure.pagesKept === 2 && probe.tailPageFailure.rowsKept === 200,
  '尾页失败形状：exit 1、stdout 为空、已得两页 200 行仍可保留')

check(withPresence.parent && withPresence.dependencies && withPresence.subIssues,
  '字段有夹具：父票、依赖摘要、子票摘要三组都出现了')
check(withPresence.issueRows === 8 && withPresence.pullRequestRows === 2,
  '字段有夹具：8 张工单 + 2 个拉取请求（got ' + withPresence.issueRows + '/' + withPresence.pullRequestRows + '）')

const m1700 = metaOf(withFields.rows, 1700, withPresence)
check(m1700.parentKey.known === true && m1700.parentKey.value === '1681',
  '字段有：1700 从 parent_issue_url 解析出父票 1681（got ' + JSON.stringify(m1700.parentKey) + '）')
check(m1700.dependencies.known === true &&
  m1700.dependencies.value.blockedBy === 3 && m1700.dependencies.value.totalBlockedBy === 3 &&
  m1700.dependencies.value.blocking === 0 && m1700.dependencies.value.totalBlocking === 0,
  '字段有：1700 依赖摘要四格为 3/3/0/0（got ' + JSON.stringify(m1700.dependencies.value) + '）')
check(m1700.subIssues.known === true && m1700.subIssues.value.total === 0 &&
  m1700.subIssues.value.completed === 0 && m1700.subIssues.value.percentCompleted === 0,
  '字段有：1700 子票摘要为 0/0/0')

const m1681 = metaOf(withFields.rows, 1681, withPresence)
check(m1681.parentKey.known === true && m1681.parentKey.value === null,
  '字段有：顶层票 1681 的父票解析为「已知没有」（不是未知）')
check(m1681.subIssues.known === true && m1681.subIssues.value.total === 19 &&
  m1681.subIssues.value.completed === 0 && m1681.subIssues.value.percentCompleted === 0,
  '字段有：1681 子票摘要 19/0/0')

const m1673 = metaOf(withFields.rows, 1673, withPresence)
check(m1673.subIssues.known === true && m1673.subIssues.value.total === 6 &&
  m1673.subIssues.value.completed === 3 && m1673.subIssues.value.percentCompleted === 50,
  '字段有：1673 子票摘要 6/3/50')
check(needsDependencyDetail(m1673.dependencies) === false,
  '字段有：1673 四组依赖计数全零，不必逐票拉依赖明细')

const m1677 = metaOf(withFields.rows, 1677, withPresence)
check(m1677.dependencies.known === true &&
  m1677.dependencies.value.blockedBy === 0 && m1677.dependencies.value.totalBlockedBy === 3 &&
  m1677.dependencies.value.blocking === 1 && m1677.dependencies.value.totalBlocking === 1,
  '字段有：1677 四格为 0/3/1/1（total 与直接计数可不等）')
check(needsDependencyDetail(m1677.dependencies) === true,
  '字段有：1677 只要四格里有非零就判为要逐票拉依赖明细')

const m1667 = metaOf(withFields.rows, 1667, withPresence)
check(m1667.subIssues.known === true && m1667.subIssues.value.percentCompleted === 100,
  '字段有：1667 子票完成百分比 100')
check(metaOf(withFields.rows, 1601, withPresence).parentKey.value === '1549',
  '字段有：第二页的 1601 也解析出父票 1549')
check(metaOf(withFields.rows, 1598, withPresence).parentKey.value === null,
  '字段有：第二页顶层票 1598 的父票解析为「已知没有」')

const pr1622 = metaOf(withFields.rows, 1622, withPresence)
check(pr1622.rowKind === 'pull-request' &&
  pr1622.parentKey.known === false && pr1622.parentKey.reason === 'not-applicable' &&
  pr1622.dependencies.known === false && pr1622.subIssues.known === false,
  '字段有：拉取请求行三组关系字段都不适用（不按零/空处理）')
const prFallback = chooseParentKey(pr1622, { parentKey: '1681' })
check(prFallback.parentKey === '1681' && prFallback.source === 'previous-known',
  '字段有：拉取请求拿不到父票时用上次已知（got ' + JSON.stringify(prFallback) + '）')

const brokenParentRow = { ...rowOf(withFields.rows, 1700), parent_issue_url: 'https://api.github.com/repos/example/repo/pulls/1681' }
const brokenParent = parseRestListRowMetadata(brokenParentRow, withPresence)
check(brokenParent.parentKey.known === false && brokenParent.parentKey.reason === 'unreadable',
  '字段有：父票链接形状不对时标「读不懂」，不硬猜编号')
const brokenDepsRow = { ...rowOf(withFields.rows, 1700), issue_dependencies_summary: { blocked_by: -1, total_blocked_by: 3, blocking: 0, total_blocking: 0 } }
const brokenDeps = parseRestListRowMetadata(brokenDepsRow, withPresence)
check(brokenDeps.dependencies.known === false && brokenDeps.dependencies.reason === 'unreadable',
  '字段有：依赖摘要出现负数时整组标「读不懂」，不回落成零')

function shapeProbe (rows, presence) {
  const failures = []
  const a = metaOf(rows, 1700, presence)
  if (!(a.parentKey.known && a.parentKey.value === '1681')) failures.push('parent')
  if (!(a.dependencies.known && a.dependencies.value.blockedBy === 3)) failures.push('dependencies')
  const b = metaOf(rows, 1681, presence)
  if (!(b.subIssues.known && b.subIssues.value.total === 19)) failures.push('subIssues')
  return failures
}
check(shapeProbe(withFields.rows, withPresence).length === 0,
  '负例前半：字段有夹具跑同一组形状断言必须全过')
check(shapeProbe(withoutFields.rows, withoutPresence).length === 3,
  '负例：把夹具换成「字段无」而断言不变，父票/依赖/子票三条必须都红（got ' + JSON.stringify(shapeProbe(withoutFields.rows, withoutPresence)) + '）')

check(!withoutPresence.parent && !withoutPresence.dependencies && !withoutPresence.subIssues,
  '字段无夹具：整页三组字段都没出现')
check(withoutPresence.issueRows === 8 && withoutPresence.pullRequestRows === 2,
  '字段无夹具仍是 8 张工单 + 2 个拉取请求')
const n1700 = metaOf(withoutFields.rows, 1700, withoutPresence)
check(n1700.parentKey.known === false && n1700.parentKey.reason === 'not-expressed',
  '字段无：1700 的父票标「接口未表达」，不是「没有父票」')
check(n1700.dependencies.known === false && n1700.subIssues.known === false,
  '字段无：依赖摘要与子票摘要都标未知')

const noPrevious = chooseParentKey(n1700, undefined)
check(noPrevious.parentKey === null && noPrevious.source === 'unavailable',
  '字段无：没有上次已知时父票只能是「拿不到」（got ' + JSON.stringify(noPrevious) + '）')
const withPrevious = chooseParentKey(n1700, { parentKey: '1681' })
check(withPrevious.parentKey === '1681' && withPrevious.source === 'previous-known',
  '字段无：有上次已知时父票走退路保留 1681（got ' + JSON.stringify(withPrevious) + '）')
const depsFallback = chooseDependenciesSummary(n1700, { dependencies: { blockedBy: 3, blocking: 0, totalBlockedBy: 3, totalBlocking: 0 } })
check(depsFallback.source === 'previous-known' && depsFallback.dependencies.blockedBy === 3,
  '字段无：依赖摘要走退路保留上次已知')
const subsFallback = chooseSubIssuesSummary(n1700, { subIssues: { total: 19, completed: 0, percentCompleted: 0 } })
check(subsFallback.source === 'previous-known' && subsFallback.subIssues.total === 19,
  '字段无：子票摘要走退路保留上次已知 19')
check(needsDependencyDetail(n1700.dependencies) === null,
  '字段无：依赖是否要逐票拉也是未知，不能返回「不用拉」')
let withoutParsed = 0
for (const row of withoutFields.rows) {
  try { parseRestListRowMetadata(row, withoutPresence); withoutParsed += 1 } catch (e) {
    check(false, '字段无：解析 ' + row.number + ' 时不该抛错（' + (e && e.message) + '）')
  }
}
check(withoutParsed === 10, '字段无：10 行全部解析完成且不抛错（got ' + withoutParsed + '）')

if (!process.exitCode) console.log('\nGREEN 全部通过 — GitHub REST 降级（list/get）就绪')
else console.log('\nRED 存在失败项')
