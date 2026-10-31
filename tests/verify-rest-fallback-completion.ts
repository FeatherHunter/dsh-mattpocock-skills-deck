#!/usr/bin/env node
/**
 * 门禁：REST 列表降级的关系补齐（票 #1691，规格 #1681 阶段 4）。
 *
 * 现场：GraphQL 不可用时整仓列表掉到 REST，行里其实带着父票链接、依赖摘要、子票摘要三组关系字段。
 * 本门禁拿 #1682 的两份真机夹具（有字段 / 无字段）当输入，跑真实的 listIssues 降级路径，断言：
 *  1. 有字段时：父票边零额外请求补齐；依赖只对计数大于零的票逐张拉一次；子票计数直接用行内摘要不翻页；
 *  2. 没有父票链接时：父边按「未知」处理（不是「没有父票」），再退回容器子票兜底；
 *  3. 已关闭容器不猜父子边，不发子票请求；
 *  4. 每条补齐请求都有上限：依赖明细每张候选票恰好一次，不重复发。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-rest-fallback-completion.ts
 */
// 门禁归属: src/tracker/rooms/github/read/rest-list-relations.ts
// 门禁归属: src/tracker/rooms/github/read/issues.ts
// 门禁归属: src/tracker/rooms/github/read/parent-repair.ts
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-rest-fallback-completion'

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
function rowsOf(name: string): any[] {
  const box = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/1682', name), 'utf8'))
  return clone(box.rows)
}

const { listIssues } = await import(pathToFileURL(resolve(ROOT, 'src/tracker/rooms/github/read/issues.ts')).href)
const { completeRestListRelations } = await import(pathToFileURL(resolve(ROOT, 'src/tracker/rooms/github/read/rest-list-relations.ts')).href)
const { createOutboundControl } = await import(pathToFileURL(resolve(ROOT, 'src/refresh/rooms/host/outbound-control.ts')).href)

const repo = { refId: 'example/repo', name: 'example/repo' }

/** 造一个 GraphQL 恒失败、REST 恒成功的假世界；把每一笔外部调用原样记下来供断言。 */
function makeWorld(opts: { rows: any[]; deps?: Record<string, any[]>; subs?: Record<string, any[]> }) {
  const world: any = { calls: [] as string[], depCalls: [] as string[], subCalls: [] as string[], listPages: 0, ctx: null }
  world.ctx = {
    cwd: ROOT,
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async (name: string) => (name === 'gh' ? 'gh' : null) },
    exec: async function (cmd: string, args: string[]) {
      const joined = (args || []).join(' ')
      world.calls.push(joined)
      if (joined.includes('graphql')) return { code: 1, stdout: '', stderr: 'Post \"https://api.github.com/graphql\": unexpected EOF' }
      if (joined.includes('/pulls?state=all')) return { code: 0, stdout: '[]', stderr: '' }
      if (joined.includes('/issues?state=all')) {
        const m = /[?&]page=(\d+)/.exec(joined)
        const p = m ? Number(m[1]) : 1
        world.listPages = Math.max(world.listPages, p)
        return { code: 0, stdout: JSON.stringify(opts.rows.slice((p - 1) * 100, p * 100)), stderr: '' }
      }
      const dep = /issues\/(\d+)\/dependencies\/blocked_by/.exec(joined)
      if (dep) {
        const n = dep[1]
        world.depCalls.push(n)
        const body = opts.deps ? opts.deps[n] : undefined
        if (body === undefined) return { code: 1, stdout: '', stderr: 'HTTP 404' }
        return { code: 0, stdout: JSON.stringify(body), stderr: '' }
      }
      const sub = /issues\/(\d+)\/sub_issues/.exec(joined)
      if (sub) {
        const n = sub[1]
        world.subCalls.push(n)
        return { code: 0, stdout: JSON.stringify((opts.subs && opts.subs[n]) || []), stderr: '' }
      }
      return { code: 1, stdout: '', stderr: 'unexpected args: ' + joined }
    },
  }
  return world
}

function itemOf(res: any, n: number): any {
  return (res && res.data ? res.data : []).find((x: any) => String(x.key) === String(n))
}
function keysOf(refs: any[] | undefined): string {
  return (refs || []).map((r: any) => String(r.key)).join(',')
}

// ---------- 1. 有字段夹具：父边零请求、依赖逐票一次、子票计数不翻页 ----------
console.log('有字段夹具：行内关系直接补齐')
const withRows = rowsOf('rest-list-with-fields.json')
const depsAnswers: Record<string, any[]> = {
  '1700': [{ number: 301, title: '依赖 301', state: 'closed' }, { number: 302, title: '依赖 302', state: 'open' }, { number: 303, title: '依赖 303', state: 'open' }],
  '1699': [{ number: 311, title: '依赖 311', state: 'open' }],
  '1677': [],
  '1601': [],
}
const w1 = makeWorld({ rows: withRows, deps: depsAnswers })
const r1 = await listIssues(repo, {}, w1.ctx)
check(r1 && r1.ok === true, '列表降级成功（GraphQL 失败后走 REST）')
check(r1 && r1.fallback === 'rest', '回包自曝来源 REST（got ' + (r1 && r1.fallback) + '）')
check(r1 && r1.data.length === 10, '降级后行数一条不少（got ' + (r1 && r1.data.length) + '）')
check(w1.listPages === 1, '只是 10 行样本，REST 只翻一页（got ' + w1.listPages + '）')
check(w1.depCalls.length === 4, '依赖明细只对计数大于零的 4 张候选票各发一次（got ' + w1.depCalls.length + '）')
check(w1.depCalls.slice().sort().join(',') === '1601,1677,1699,1700', '候选票正是四格计数大于零的那四张（got ' + w1.depCalls.join(',') + '）')
check(w1.subCalls.length === 0, '父票链接整页表达时不发任何 /sub_issues 请求（got ' + w1.subCalls.length + '）')

const i1700 = itemOf(r1, 1700)
const i1699 = itemOf(r1, 1699)
const i1681 = itemOf(r1, 1681)
const i1677 = itemOf(r1, 1677)
const i1673 = itemOf(r1, 1673)
const i1667 = itemOf(r1, 1667)
const i1598 = itemOf(r1, 1598)
const i1601 = itemOf(r1, 1601)
const i1622 = itemOf(r1, 1622)
const i1587 = itemOf(r1, 1587)
check(!!i1700 && i1700.parentKey === '1681', '1700 的父票边从行内链接补出（got ' + (i1700 && i1700.parentKey) + '）')
check(!!i1699 && i1699.parentKey === '1681', '1699 的父票边从行内链接补出（got ' + (i1699 && i1699.parentKey) + '）')
check(!!i1601 && i1601.parentKey === '1549', '1601 的父票边从行内链接补出（got ' + (i1601 && i1601.parentKey) + '）')
check(!!i1677 && i1677.parentKey === '1673', '1677 的父票边从行内链接补出（got ' + (i1677 && i1677.parentKey) + '）')
check(!!i1681 && i1681.parentKey === null && i1681.fieldStates.parents.known === true, '整页表达了父票链接、这行却没有键：读成「明确没有父票」而不是未知')
check(!!i1598 && i1598.parentKey === null && i1598.fieldStates.parents.known === true, '1598 同样读成明确的顶层票（known null）')
check(!!i1622 && i1622.fieldStates.parents.known === false && i1622.fieldStates.parents.reason === 'not-applicable', '拉取请求行没有工单父子关系：记「不适用」')
check(!!i1587 && i1587.fieldStates.parents.reason === 'not-applicable', '另一个拉取请求行同样记「不适用」')

check(!!i1700 && i1700.fieldStates.dependencies.known === true, '1700 的依赖边已知（不是未知）')
check(!!i1700 && keysOf(i1700.blockedBy) === '301,302,303', '1700 的直接依赖边补齐三条（got ' + keysOf(i1700 && i1700.blockedBy) + '）')
check(!!i1699 && keysOf(i1699.blockedBy) === '311', '1699 的直接依赖边补齐一条（got ' + keysOf(i1699 && i1699.blockedBy) + '）')
check(!!i1677 && i1677.fieldStates.dependencies.known === true && (i1677.blockedBy || []).length === 0, '1677 直接依赖为零：发了明细核对后记成空数组（不是未知）')
check(!!i1601 && i1601.fieldStates.dependencies.known === true && (i1601.blockedBy || []).length === 0, '1601 直接依赖为零：发过明细、核对后记成空数组')
check(!!i1681 && i1681.fieldStates.dependencies.known === true && (i1681.blockedBy || []).length === 0, '1681 四格全零：不发请求，直接记空数组')
check(!w1.depCalls.includes('1681'), '四格全零的票不发起依赖明细请求（省请求）')
check(!!i1598 && !w1.depCalls.includes('1598'), '1598 四格全零：不发起请求')

check(!!i1681 && i1681.fieldStates.subIssues.known === true && i1681.fieldStates.subIssues.value.total === 19, '1681 子票计数来自列表行摘要（total=19）')
check(!!i1673 && i1673.fieldStates.subIssues.known === true && i1673.fieldStates.subIssues.value.total === 6 && i1673.fieldStates.subIssues.value.completed === 3 && i1673.fieldStates.subIssues.value.percentCompleted === 50, '1673 子票计数 6/3/50 来自行内摘要')
check(!!i1667 && i1667.fieldStates.subIssues.known === true && i1667.fieldStates.subIssues.value.total === 2 && i1667.fieldStates.subIssues.value.percentCompleted === 100, '1667 子票计数 2/2/100 来自行内摘要')
check(!!i1699 && i1699.fieldStates.subIssues.known === true && i1699.fieldStates.subIssues.value.total === 0, '1699 子票计数为零也是已知事实')
check(!!i1587 && i1587.fieldStates.subIssues.reason === 'not-applicable', '拉取请求行没有子票：记「不适用」')
check((r1.data || []).map((x: any) => String(x.key)).join(',') === withRows.map((r: any) => String(r.number)).join(','), '降级后行顺序与回包顺序一致（排序留给投影层，存储层不动位置）')

// ---------- 2. 直接调模块：这一趟补了几组、发了几条 ----------
const uRows = rowsOf('rest-list-with-fields.json')
const wu = makeWorld({ rows: uRows, deps: depsAnswers })
const facts = await completeRestListRelations(uRows, { owner: 'example', name: 'repo' }, wu.ctx)
check(facts.presence.parent === true, '整页字段出现性：父票链接出现')
check(facts.parentFromRows === true, '父票边已能从行内补齐（调用方据此跳过子票兜底）')
check(facts.dependencyCandidates === 4, '依赖候选票 4 张（got ' + facts.dependencyCandidates + '）')
check(facts.dependencyFetched === 4, '依赖明细四张全部取回（got ' + facts.dependencyFetched + '）')
check(facts.dependencyFailed === 0, '依赖明细没有失败（got ' + facts.dependencyFailed + '）')
check(wu.subCalls.length === 0, '这一趟一条子票请求都没发（got ' + wu.subCalls.length + '）')

// ---------- 3. 负例：去掉行内父票链接，父边必须走「未知」而不是「没有父票」 ----------
console.log('负例：父票链接整页缺失')
const negRows = rowsOf('rest-list-with-fields.json')
for (const r of negRows) delete r.parent_issue_url
const w2 = makeWorld({ rows: negRows, deps: depsAnswers, subs: { '1673': [{ number: 1700, title: '子票 1700', state: 'open' }] } })
const r2 = await listIssues(repo, {}, w2.ctx)
check(r2 && r2.ok === true && r2.data.length === 10, '缺父票链接时列表照样降级成功、行数不少')
check(w2.subCalls.join(',') === '1673', '只对唯一一张已打开的容器票 1673 发一次子票兜底（got ' + w2.subCalls.join(',') + '）')
const n1681 = itemOf(r2, 1681)
const n1598 = itemOf(r2, 1598)
check(!!n1681 && n1681.parentKey === null, '缺少父票链接的 1681：parentKey 仍是 null（字段只能这么放）')
check(!!n1681 && n1681.fieldStates.parents.known === false && n1681.fieldStates.parents.reason === 'not-expressed', '缺少父票链接的 1681：父边记「未表达」，不是「没有父票」')
check(!!n1598 && n1598.fieldStates.parents.reason === 'not-expressed', '1598 同样记「未表达」')
const n1700 = itemOf(r2, 1700)
check(!!n1700 && n1700.parentKey === '1673', '子票兜底仍可把 1700 挂到 1673 下（未知不等于放弃补）')
check(!!n1700 && n1700.fieldStates.dependencies.known === true && keysOf(n1700.blockedBy) === '301,302,303', '父边缺链接不影响依赖边：依赖仍按行内摘要补齐')

// ---------- 4. 已关闭容器不猜父子边 ----------
console.log('已关闭容器：不猜父子边')
const closedRows = [
  { number: 5001, title: '已关闭的地图', state: 'closed', labels: [{ name: 'wayfinder:map' }], user: { login: 't' }, html_url: 'https://github.com/example/repo/issues/5001', issue_dependencies_summary: { blocked_by: 0, total_blocked_by: 0, blocking: 0, total_blocking: 0 }, sub_issues_summary: { total: 1, completed: 0, percent_completed: 0 } },
  { number: 5002, title: '子票', state: 'open', labels: [{ name: 'bug' }], user: { login: 't' }, html_url: 'https://github.com/example/repo/issues/5002', issue_dependencies_summary: { blocked_by: 0, total_blocked_by: 0, blocking: 0, total_blocking: 0 }, sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 } },
]
const w3 = makeWorld({ rows: closedRows, subs: { '5001': [{ number: 5002, title: '子票 5002', state: 'open' }] } })
const r3 = await listIssues(repo, {}, w3.ctx)
check(r3 && r3.ok === true && r3.data.length === 2, '已关闭容器样本降级成功、两行都在')
check(w3.subCalls.length === 0, '已关闭容器不发子票请求（不拿过时子树当首帧事实，got ' + w3.subCalls.length + '）')
const c5002 = itemOf(r3, 5002)
check(!!c5002 && c5002.fieldStates.parents.known === false && c5002.fieldStates.parents.reason === 'not-expressed', '关闭容器的子票父边保持「未表达」')
check(!!c5002 && c5002.fieldStates.subIssues.known === true && c5002.fieldStates.subIssues.value.total === 0, '子票自己的计数仍按行内摘要补齐')

printGateResult(GATE, total, failed ? 1 : 0)
process.exit(failed ? 1 : 0)
