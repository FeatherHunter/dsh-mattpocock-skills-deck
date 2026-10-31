// tests/verify-1765-read-channel-plan.ts —— 门禁：#1765 读操作按「花费渠道计划」放行
//
// 门禁归属: src/tracker/contract/operations-encyclopedia.ts
// 门禁归属: src/refresh/kernel/budget-admission.ts
// 门禁归属: src/tracker/session/pipeline.ts
// 门禁归属: src/tracker/rooms/github/routing/read-channels.ts
// 门禁归属: src/tracker/rooms/github/read/issues.ts
// 门禁归属: src/tracker/rooms/github/read/deps-read.ts
//
// 这张票要修的病：额度闸只按操作名分「读 / 写」，不回答这一次读真正会花哪一族额度，
// 于是两条毛病同时存在——
//   一、REST-only 的读（探活、当前用户、仓库权限、标签清单）本身只走 REST，却在 GraphQL 见底时被拦；
//   二、双渠道的读（列表、单票、依赖）GraphQL 见底时整条被拦，明明 REST 还有余量，也不会降级过去。
// 修法是把「这一次读允许走哪些渠道、按什么顺序」变成裁决的输出：闸放行时给出有序渠道计划，
// 房间只在计划内换渠道，计划外一次都不试。
//
// 本门禁量四组事：
//   A. 百科里 12 条读的花费渠道计划与实现一致（REST-only 四条、双渠道三条、GraphQL-only 四条、本地一条）；
//   B. 额度闸按计划放行：两族都有余量给全计划；一族见底只剩另一族；两族都见底才拒，并点名缺的额度；
//      单渠道读见底就拒，不再被另一族的余量误放行（#1681 的反面）。
//   C. 放行时交出的渠道计划里，绝不出现低于保底的那一族；顺序就是百科里写的顺序。
//   D. 管线把计划原样交给房间：只替换最后一个上下文实参的 readChannels，不改别的实参、不改调用方对象；
//      被拦下的那一笔房间一次都不碰。
//   E. 房间照计划选路（stub 掉 gh 执行器、真调读函数）：计划外的渠道一次都不发命令；
//      计划只剩一族时失败也不回头试另一族；计划含两族时行为与从前一致。
//
// 跑法（插件根目录；不需要先构建，本门禁跑真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1765-read-channel-plan.ts
import { OPERATIONS } from '../src/tracker/contract/operations-catalog.js'
import {
  OPERATION_ENCYCLOPEDIA,
  READ_SPEND_CHANNELS,
} from '../src/tracker/contract/operations-encyclopedia.js'
import type { ReadSpendChannel } from '../src/tracker/contract/operations-encyclopedia.js'
import { decideByBudget, familiesOfOp } from '../src/refresh/kernel/budget-admission.js'
import { runPipelineOp } from '../src/tracker/session/pipeline.js'
import { getIssue, listIssues } from '../src/tracker/rooms/github/read/issues.js'
import { getDependencies } from '../src/tracker/rooms/github/read/deps-read.js'
import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.js'

let failed = false
let total = 0
const check = function (ok: boolean, msg: string, got?: unknown): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (got === undefined ? '' : '（实得 ' + JSON.stringify(got) + '）'))
  if (!ok) failed = true
}

// 服务端上限 5000，保底按 5% 是 250（与 host-budget.ts 同一个口径，数字由本门禁自己注入）。
const limits: any = {
  pluginShareOfRemaining: 0.35,
  hourlyAllowance: function (n: number): number { return n },
  writeReserve: function (a: number): number { return Math.floor(a * 0.3) },
  aiToolFloor: function (n: number): number { return Math.floor(n * 0.05) },
  tierFor: function (): string { return 'green' },
}
const twoBuckets: any = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }
const reading = function (rest: number, graphql: number): any {
  return { known: true, kind: 'two-buckets', buckets: {
    rest: { remaining: rest, limit: 5000 },
    graphql: { remaining: graphql, limit: 5000 },
  } }
}
const decide = function (op: string, rest: number, graphql: number): any {
  return decideByBudget({ op: op, budget: twoBuckets, reading: reading(rest, graphql), canWrite: true }, limits)
}
const channelsOf = function (decision: any): string[] {
  return Array.isArray(decision && decision.channels) ? decision.channels.slice() : []
}

// ── A. 百科里的花费渠道计划 ────────────────────────────────────────────────
// 这 12 条是仓库今天的真实实现：探活 / 当前用户 / 仓库权限 / 标签清单只有 REST；
// 列表 / 单票 / 依赖 GraphQL 主路 + REST 兜底；计数 / 翻页 / 子票 / 地图只有 GraphQL；
// 读预算读插件自己的账本，不花远端额度。
const EXPECTED_PLANS: Record<string, ReadSpendChannel[]> = {
  preflight: ['rest'],
  list: ['graphql', 'rest'],
  get: ['graphql', 'rest'],
  getDependencies: ['graphql', 'rest'],
  getCurrentUser: ['rest'],
  listLabels: ['rest'],
  counts: ['graphql'],
  listPage: ['graphql'],
  getRepoPermissions: ['rest'],
  listSubIssues: ['graphql'],
  listMaps: ['graphql'],
  readBudget: ['local'],
}
for (const op of Object.keys(EXPECTED_PLANS)) {
  const profile: any = (OPERATION_ENCYCLOPEDIA as any)[op]
  const ok = !!profile && profile.kind === 'read' && Array.isArray(profile.spend)
    && JSON.stringify(profile.spend) === JSON.stringify(EXPECTED_PLANS[op])
  check(ok, 'A、' + op + ' 的花费渠道计划是 [' + EXPECTED_PLANS[op].join(', ') + ']', profile && profile.spend)
}
const readOps = OPERATIONS.filter(function (op: string): boolean { return ((OPERATION_ENCYCLOPEDIA as any)[op] || {}).kind === 'read' })
const badPlans = readOps.filter(function (op: string): boolean {
  const plan: any = ((OPERATION_ENCYCLOPEDIA as any)[op] || {}).spend
  return !Array.isArray(plan) || plan.length === 0 || plan.some(function (c: string): boolean { return READ_SPEND_CHANNELS.indexOf(c as never) < 0 })
})
check(badPlans.length === 0, 'A、每条读操作都声明了合法的花费渠道计划（' + readOps.length + ' 条）', badPlans)
const writePlanLeak = OPERATIONS.filter(function (op: string): boolean {
  const profile: any = (OPERATION_ENCYCLOPEDIA as any)[op] || {}
  return profile.kind === 'write' && profile.spend !== undefined
})
check(writePlanLeak.length === 0, 'A、写操作不带花费渠道计划（通道选择不是这张票的范围）', writePlanLeak)
check(JSON.stringify(familiesOfOp('counts')) === JSON.stringify({ all: ['graphql'], anyOf: [] }),
  'A、GraphQL-only 读的族选择仍是「只差 GraphQL 不可」', familiesOfOp('counts'))
check(JSON.stringify(familiesOfOp('list')) === JSON.stringify({ all: [], anyOf: ['graphql', 'rest'] }),
  'A、双渠道读的族选择是「两族任走一条即可」', familiesOfOp('list'))
check(JSON.stringify(familiesOfOp('preflight')) === JSON.stringify({ all: ['rest'], anyOf: [] }),
  'A、REST-only 读的族选择是「只差 REST 不可」', familiesOfOp('preflight'))

// ── B. 额度闸按计划放行 ────────────────────────────────────────────────────
const bothAlive: any = decide('list', 4000, 4000)
check(bothAlive.allowed === true && JSON.stringify(channelsOf(bothAlive)) === JSON.stringify(['graphql', 'rest']),
  'B、两族都有余量：列表计划是 GraphQL 主路 + REST 兜底', bothAlive)
const graphqlDead: any = decide('list', 4000, 200)
check(graphqlDead.allowed === true && JSON.stringify(channelsOf(graphqlDead)) === JSON.stringify(['rest']),
  'B、GraphQL 见底：列表只走 REST（#1765 要修的主症状）', graphqlDead)
const restDead: any = decide('get', 200, 4000)
check(restDead.allowed === true && JSON.stringify(channelsOf(restDead)) === JSON.stringify(['graphql']),
  'B、REST 见底：单票只走 GraphQL，不许先花 REST 再失败', restDead)
const depsGraphqlDead: any = decide('getDependencies', 4000, 200)
check(depsGraphqlDead.allowed === true && JSON.stringify(channelsOf(depsGraphqlDead)) === JSON.stringify(['rest']),
  'B、GraphQL 见底：依赖投影只走 REST', depsGraphqlDead)
const bothDead: any = decide('list', 200, 200)
check(bothDead.allowed === false && String(bothDead.message || '').indexOf('两种额度都不够') >= 0,
  'B、两族都见底：双渠道读被拒，并点名两种额度', bothDead)
const restOnlyBlocked: any = decide('preflight', 200, 4000)
check(restOnlyBlocked.allowed === false && String(restOnlyBlocked.message || '').indexOf('REST 请求') >= 0,
  'B、REST-only 读在 REST 见底时被拒（GraphQL 有余也不能顶替）', restOnlyBlocked)
const restOnlyAlive: any = decide('getRepoPermissions', 4000, 200)
check(restOnlyAlive.allowed === true && JSON.stringify(channelsOf(restOnlyAlive)) === JSON.stringify(['rest']),
  'B、REST-only 读在 GraphQL 见底时照常放行（#1681 的正例）', restOnlyAlive)
const graphqlOnlyBlocked: any = decide('counts', 4000, 200)
check(graphqlOnlyBlocked.allowed === false && String(graphqlOnlyBlocked.message || '').indexOf('GraphQL 点数') >= 0,
  'B、GraphQL-only 读在 GraphQL 见底时被拒（REST 有余也不能顶替）', graphqlOnlyBlocked)
const graphqlOnlyAlive: any = decide('listMaps', 200, 4000)
check(graphqlOnlyAlive.allowed === true && JSON.stringify(channelsOf(graphqlOnlyAlive)) === JSON.stringify(['graphql']),
  'B、GraphQL-only 读在 REST 见底时照常放行', graphqlOnlyAlive)
const localRead: any = decide('readBudget', 200, 200)
check(localRead.allowed === true, 'B、读预算不花远端额度：两族都见底也放行', localRead)
// 写操作的行为不动：改票只看 GraphQL，REST 见底照做；建票两族都要，GraphQL 见底拦住。
const restDeadEdit: any = decide('update', 200, 4000)
check(restDeadEdit.allowed === true && restDeadEdit.channels === undefined,
  'B、写操作行为不变：REST 见底时改票照做，且不带读渠道计划', restDeadEdit)
const graphqlDeadCreate: any = decide('create', 4000, 200)
check(graphqlDeadCreate.allowed === false, 'B、写操作行为不变：GraphQL 见底时建票被拦', graphqlDeadCreate)
// 读数未知时不能凭空砍渠道：放行，并按百科的全计划交出可用渠道（房间照旧先 GraphQL 再 REST）。
const unknownReading: any = decideByBudget({ op: 'list', budget: twoBuckets, reading: { known: false, reason: 'not-measured' }, canWrite: true }, limits)
check(unknownReading.allowed === true && JSON.stringify(channelsOf(unknownReading)) === JSON.stringify(['graphql', 'rest']),
  'B、读数未知：放行并交出全计划（未知不是见底）', unknownReading)
// 只计请求的后端（GitLab 这类）不走两桶分支，行为不变。
const requestsOnlyBudget: any = { kind: 'requests-only', countsRequests: true, countsPoints: false, independentBuckets: false }
const requestsOnly: any = decideByBudget({ op: 'list', budget: requestsOnlyBudget, reading: { known: true, kind: 'requests-only', requests: { remaining: 4000, limit: 5000 } }, canWrite: true }, limits)
check(requestsOnly.allowed === true, 'B、只计请求的后端照旧放行（这条票只改两桶后端）', requestsOnly)

// ── C. 计划里不出现低于保底的那一族，顺序照百科 ────────────────────────────
const planCases: Array<[string, number, number]> = [
  ['list', 4000, 4000], ['list', 4000, 200], ['list', 200, 4000],
  ['get', 4000, 4000], ['get', 4000, 200], ['get', 200, 4000],
  ['getDependencies', 4000, 4000], ['getDependencies', 4000, 200], ['getDependencies', 200, 4000],
]
const planProblems: string[] = []
for (const [op, rest, graphql] of planCases) {
  const d: any = decide(op, rest, graphql)
  const got = channelsOf(d)
  const floor = 250
  if (got.indexOf('graphql') >= 0 && graphql - 0 <= floor) planProblems.push(op + ' 在 GraphQL 见底时仍给出 graphql')
  if (got.indexOf('rest') >= 0 && rest - 0 <= floor) planProblems.push(op + ' 在 REST 见底时仍给出 rest')
  const expected = EXPECTED_PLANS[op].filter(function (c: string): boolean {
    return c === 'graphql' ? graphql > floor : rest > floor
  })
  if (JSON.stringify(got) !== JSON.stringify(expected)) planProblems.push(op + '(' + rest + '/' + graphql + ') 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(got))
}
check(planProblems.length === 0, 'C、放行计划只含高于保底的渠道，顺序照百科', planProblems)

// ── D. 管线把计划交给房间 ──────────────────────────────────────────────────
const makeDeps = function (op: string, decision: any, calls: any[]): any {
  return {
    tracker: {
      list: async function (...args: unknown[]): Promise<unknown> {
        calls.push(args)
        return { ok: true, data: [], provenance: {} }
      },
    },
    budget: twoBuckets,
    canWrite: true,
    getCachedReading: function (): unknown { return reading(4000, 200) },
    admit: async function (): Promise<unknown> { return decision },
    accountPort: async function (): Promise<void> {},
    backendId: 'github',
    caller: 'deck-tool',
    account: 'ai-tool',
  }
}
async function partD(): Promise<void> {
  const calls: any[] = []
  const ctxArg: any = { cwd: '/ws', signal: new AbortController().signal, caller: 'deck-tool', opId: 'op-1765' }
  const args = [{ refId: 'acme/widgets' }, { state: 'open' }, ctxArg]
  await runPipelineOp(makeDeps('list', { allowed: true, reason: 'sufficient', channels: ['rest'] }, calls), 'list', args)
  check(calls.length === 1, 'D、放行的一笔真的交给了房间一次', calls.length)
  const roomCtx = calls.length ? calls[0][2] : null
  check(!!roomCtx && JSON.stringify(roomCtx.readChannels) === JSON.stringify(['rest']),
    'D、房间拿到的上下文写着这次允许走的渠道计划', roomCtx && roomCtx.readChannels)
  check(!!roomCtx && calls[0][0] === args[0] && calls[0][1] === args[1],
    'D、除上下文外别的实参原样交给房间', calls.length ? [calls[0][0] === args[0], calls[0][1] === args[1]] : null)
  check(ctxArg.readChannels === undefined, 'D、调用方传进来的上下文对象不被改写（管线给的是浅拷贝）', ctxArg.readChannels)
  const deniedCalls: any[] = []
  const denied = await runPipelineOp(makeDeps('list', { allowed: false, kind: 'rate-limit', reason: 'exhausted', message: '额度见底' }, deniedCalls), 'list', args)
  check(deniedCalls.length === 0, 'D、被拦下的一笔房间一次都不碰', deniedCalls.length)
  check(!!denied && (denied as any).ok === false, 'D、被拦下的一笔回失败信封', denied)
}

// ── E. 房间照计划选路（stub 执行器，真调读函数） ─────────────────────────────
const REPO: any = { backend: 'github', refId: 'acme/widgets', name: 'widgets', url: '' }

function okExec(payload: any): any { return { stdout: JSON.stringify(payload), stderr: '', code: 0 } }
function failExec(): any { return { stdout: '', stderr: 'boom', code: 1 } }

// 一次 gh 调用按参数分出渠道：execGh 不把 via 传给执行器，只能看命令本身。
function classifyCall(args: any): any {
  const list = Array.isArray(args) ? args : []
  if (list[0] !== 'api') return { channel: 'other', kind: 'other' }
  if (list[1] === 'graphql') return { channel: 'graphql', kind: 'gql' }
  const pathArg = String(list[1] || '')
  const base = pathArg.split('?')[0]
  let kind = 'rest.other'
  if (/\/issues\/\d+\/comments$/.test(base)) kind = 'rest.comments'
  else if (/\/issues$/.test(base)) kind = 'rest.issues'
  else if (/\/pulls$/.test(base)) kind = 'rest.pulls'
  else if (/\/issues\/\d+$/.test(base)) kind = 'rest.issue'
  else if (/\/pulls\/\d+$/.test(base)) kind = 'rest.pull'
  return { channel: 'rest', kind: kind }
}

function makeRoom(handler: any): any {
  const calls: any[] = []
  const ctx: any = {
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async function (): Promise<string> { return 'gh' } },
    exec: async function (cmd: string, args: any): Promise<any> {
      const info = classifyCall(args)
      calls.push(info)
      return handler(info, args)
    },
    cwd: '.',
    logEvent: function (): void {},
    isEnabled: function (): boolean { return false },
  }
  return { ctx: ctx, calls: calls }
}

function kinds(room: any): string[] {
  return room.calls.map(function (c: any): string { return c.kind })
}
function gqlListEnvelope(nodes: any[]): any {
  return { data: { repository: { issues: { nodes: nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } }
}
function gqlPullsEnvelope(): any {
  return { data: { repository: { pullRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }
}
function gqlListIssue(n: number): any {
  return {
    number: n, title: '票' + n, state: 'OPEN', url: 'https://example.test/' + n,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
    labels: { nodes: [] }, assignees: { nodes: [] },
    comments: { totalCount: 0, nodes: [] }, blockedBy: { nodes: [] },
    parent: null, milestone: null,
  }
}
function restIssueRow(n: number): any {
  return {
    number: n, title: '票' + n, state: 'open', body: '正文', labels: [], user: { login: 'u' },
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z',
    html_url: 'https://example.test/' + n,
  }
}
function withPlan(ctx: any, plan: string[]): any {
  return Object.assign({}, ctx, { readChannels: plan })
}

async function partE(): Promise<void> {
  // E1 计划只放 REST：列表一次 GraphQL 都不发，第一笔就是 REST 整仓列表
  {
    const room = makeRoom(function (): any { return failExec() })
    const result: any = await listIssues(REPO, undefined, withPlan(room.ctx, ['rest']))
    check(room.calls.filter(function (c: any): boolean { return c.channel === 'graphql' }).length === 0,
      'E、计划只放 REST：列表不发任何 GraphQL 查询', kinds(room))
    check(kinds(room)[0] === 'rest.issues', 'E、计划只放 REST：第一笔就是 REST 整仓列表', kinds(room)[0] || null)
    check(result.ok === false, 'E、计划只放 REST 而 REST 也没成：如实失败，不拿半份当整仓', result.ok)
  }

  // E2 计划只放 GraphQL：GraphQL 失败后一次 REST 都不试，整笔如实失败
  {
    const room = makeRoom(function (): any { return failExec() })
    const result: any = await listIssues(REPO, undefined, withPlan(room.ctx, ['graphql']))
    check(room.calls.filter(function (c: any): boolean { return c.channel === 'rest' }).length === 0,
      'E、计划只放 GraphQL：GraphQL 失败后不降级 REST', kinds(room))
    check(result.ok === false, 'E、计划只放 GraphQL：没读到就失败（不假装成功）', result.ok)
  }

  // E3 计划含两渠道：行为与从前一致（GraphQL 主路成功，不发 REST）
  {
    const room = makeRoom(function (info: any): any {
      if (info.kind !== 'gql') return failExec()
      const gqlSoFar = room.calls.filter(function (c: any): boolean { return c.channel === 'graphql' }).length
      // 列表主路有两条 GraphQL：第一条取工单连接，第二条取拉取请求连接；两条回包形状不一样。
      return gqlSoFar === 1 ? okExec(gqlListEnvelope([gqlListIssue(1)])) : okExec(gqlPullsEnvelope())
    })
    const result: any = await listIssues(REPO, undefined, withPlan(room.ctx, ['graphql', 'rest']))
    check(result.ok === true && Array.isArray(result.data) && result.data.length === 1, 'E、计划含两渠道：GraphQL 主路照常成功', result.ok)
    check(!result.fallback, 'E、计划含两渠道：主路成了就不写 fallback（行为不变）', result.fallback)
    check(room.calls.filter(function (c: any): boolean { return c.channel === 'rest' }).length === 0,
      'E、计划含两渠道：主路成了不发 REST', kinds(room))
  }

  // E4 单票计划只放 REST：GraphQL 一次不发，REST 成功即成功
  {
    const room = makeRoom(function (info: any): any {
      if (info.kind === 'rest.issue') return okExec(restIssueRow(1))
      return failExec()
    })
    const result: any = await getIssue(REPO, '1', undefined, withPlan(room.ctx, ['rest']))
    check(result.ok === true, 'E、单票计划只放 REST：REST 成功即返回成功', result.ok)
    check(Boolean(result.provenance) && result.provenance.source === 'rest', 'E、单票计划只放 REST：来源记 rest', result.provenance && result.provenance.source)
    check(room.calls.filter(function (c: any): boolean { return c.channel === 'graphql' }).length === 0,
      'E、单票计划只放 REST：不发 GraphQL 查询', kinds(room))
  }

  // E5 单票计划只放 GraphQL：GraphQL 失败后不降级 REST
  {
    const room = makeRoom(function (): any { return failExec() })
    const result: any = await getIssue(REPO, '1', undefined, withPlan(room.ctx, ['graphql']))
    check(result.ok === false, 'E、单票计划只放 GraphQL：没读到就失败', result.ok)
    check(room.calls.filter(function (c: any): boolean { return c.channel === 'rest' }).length === 0,
      'E、单票计划只放 GraphQL：不降级 REST', kinds(room))
  }

  // E6 依赖投影计划只放 REST：原生 GraphQL 一次不发，兜底路真的去读了 REST 单票
  {
    const room = makeRoom(function (): any { return failExec() })
    const result: any = await getDependencies(REPO, '1', undefined, withPlan(room.ctx, ['rest']))
    check(room.calls.filter(function (c: any): boolean { return c.channel === 'graphql' }).length === 0,
      'E、依赖计划只放 REST：不发 GraphQL 原生查询', kinds(room))
    check(kinds(room).indexOf('rest.issue') >= 0, 'E、依赖计划只放 REST：兜底路真的去读目标票的 REST 端点', kinds(room))
    check(result.ok === false, 'E、依赖计划只放 REST 而 REST 也没成：如实失败', result.ok)
  }
}

async function main(): Promise<void> {
  await partD()
  await partE()
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  if (failed) process.exitCode = 1
}
main().catch(function (e: any): void {
  console.log('FAIL：门禁自己抛错 —— ' + String((e && e.stack) || e))
  process.exitCode = 1
})
