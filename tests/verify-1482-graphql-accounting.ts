// tests/verify-1482-graphql-accounting.ts —— 门禁：GitHub GraphQL 被记成 REST 请求，rest 桶虚增后把 deck 工具误停
//
// 现场（2026-10-24 真机日志，安装版 1.9.0-beta.16）：刷新探测每页走 GraphQL，账本却把每一页记成
// 一条 REST 请求（quota.spend 里 bucket=rest、requests=1、points=0，rest 桶剩下 1597 一路掉到 471），
// 于是 deck 工具被两桶裁决以「额度的一个桶已经见底，这次先不执行」拒掉；与此同时 GitHub 真实配额
// core 还剩 4700 多条、graphql 还剩 4600 多点 —— 烧的是插件自己的本地账本，不是真配额。
//
// 根因两处：客户端判 GraphQL 只看第一段（真实 argv 是 ['api','graphql',...]，永远判不中），
// 点数按固定 1 记（真实回包 rateLimit.cost 实测单页 4、一次列表 5）。
//
// 本门禁量六组事：
//   A. 判档与取点：命令行形状认得 GraphQL（真实形状 api→graphql），回包点数取得出、取不到按 0；
//      报闸/补差/日志三份口径（ghOutboundEntryOf、graphqlCorrectionOf、ghPointNoteOf）各只一层。
//   B. 客户端：GraphQL 报给闸的是 0 条 REST + 1 点（先报闸），成功后按真实 cost 补差；REST 仍报 1 条；
//      一次操作的异步信封里最终是 {requests:0, points:cost}。
//   C. 记账口：这样的信封进双桶账本后，rest 桶一条不多、graphql 桶按真实点数记。
//   D. 闸：显式 0 条照收（旧写法 num(e.requests) || 1 会把 0 抬成 1），补差口能单独补点数。
//   E. 查询文本：每条读查询都在 Query 根带 rateLimit{ cost }（否则客户端拿不到真实点数）；mutation 不算点。
//   F. 出站报账路径都换成了共享判档与共享累计（源码扫描，防止有人退回旧写法）。
//
// 判据不是「源码里出现过某段字符串」就够：A–E 把真源码加载起来喂输入、看真账本，F 只作防回退的扫描。
//
// 门禁归属: src/tracker/kernel/outbound-tiers.ts
// 门禁归属: src/tracker/rooms/github/client.ts
// 门禁归属: src/tracker/rooms/github/queries.ts
// 门禁归属: src/refresh/kernel/step-pricing.ts
// 门禁归属: src/refresh/kernel/transport-ledger.ts
// 门禁归属: src/refresh/rooms/host/refresh-gate.ts
// 门禁归属: src/refresh/rooms/host/git-execution.ts
// 门禁归属: src/host/platformChannel.ts
//
// 跑法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1482-graphql-accounting.ts
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isGraphqlGhArgs, graphqlCostOf, ghArgsOf, ghOutboundEntryOf, graphqlCorrectionOf, ghPointNoteOf } from '../src/tracker/kernel/outbound-tiers.js'
import { ghClient } from '../src/tracker/rooms/github/client.js'
import { attachOpUsage } from '../src/tracker/rooms/github/op-usage.js'
import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.js'
import { createLedger } from '../src/refresh/rooms/host/quota-ledger.js'
import { createGate } from '../src/refresh/rooms/host/refresh-gate.js'
import { createAccountPort } from '../src/refresh/kernel/backend-accounting.js'
import { measureStep, noteStepOutbound } from '../src/refresh/kernel/step-pricing.js'
import * as Q from '../src/tracker/rooms/github/queries.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CLOCK = 1700000000000

let failed = false
let total = 0
const check = function (ok: any, msg: string, got?: any): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (got === undefined ? '' : '（实得 ' + String(got) + '）'))
  if (!ok) failed = true
}

// 去掉注释再做源码扫描：注释里写的「旧写法长这样」不能被当成还在用。
const stripComments = function (text: string): string {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const lines = noBlock.split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf('//')
    kept.push(at >= 0 ? lines[i].slice(0, at) : lines[i])
  }
  return kept.join('\n')
}
const srcOf = function (rel: string): string {
  return stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))
}

// 一份「报闸收集器」：照客户端会怎么调，原样收下两条报账路径各自的入参。
const collectorOf = function (): any {
  const calls: any[] = []
  return {
    calls: calls,
    gate: {
      noteOutbound: function (entry: any): void { calls.push(['out', entry]) },
      noteOutboundCorrection: function (entry: any): void { calls.push(['fix', entry]) },
    },
  }
}

// 假 gh 客户端上下文：真起进程那一步换成固定的 stdout，其余（名额闸 / 平台 / 日志）按契约给最小件。
const ctxOf = function (stdout: string, gate: any): any {
  return {
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async function (): Promise<string> { return 'gh' } },
    exec: async function (): Promise<any> { return { stdout: stdout, stderr: '', code: 0 } },
    cwd: '.',
    logEvent: function (): void {},
    isEnabled: function (): boolean { return false },
    gate: gate,
  }
}

const gqlOut = function (cost: number): string {
  return JSON.stringify({ data: { repository: { issues: { nodes: [] } } }, rateLimit: { cost: cost } })
}

// ---------------- A. 判档与取点 ----------------
function partA(): void {
  console.log('== A、命令行形状与回包点数 ==')
  check(isGraphqlGhArgs(['api', 'graphql', '-f', 'query=query{}']) === true,
    'A、真 argv 形状（api → graphql）判成 GraphQL')
  check(isGraphqlGhArgs(['graphql', '-f', 'query=query{}']) === false,
    'A、不再认「第一段就是 graphql」的旧形状（gh 没有这个子命令，没人这样调）')
  check(isGraphqlGhArgs(['api', 'repos/o/n/issues?page=1']) === false,
    'A、REST 路径（api → repos/...）不判成 GraphQL')
  check(isGraphqlGhArgs(['issue', 'list', '--repo', 'o/n']) === false,
    'A、普通 gh 子命令不判成 GraphQL')
  check(isGraphqlGhArgs([]) === false, 'A、空参数不判成 GraphQL')
  check(graphqlCostOf(gqlOut(5)) === 5, 'A、回包 rateLimit.cost=5 取得出 5')
  check(graphqlCostOf(gqlOut(1)) === 1, 'A、回包 rateLimit.cost=1 取得出 1')
  check(graphqlCostOf('{"data":{}}') === 0, 'A、回包没有 rateLimit 时按 0（不瞎猜）')
  check(graphqlCostOf('not json') === 0, 'A、回包不是 JSON 时按 0')
  check(graphqlCostOf(JSON.stringify({ rateLimit: { cost: 2.9 } })) === 2, 'A、点数不是整数时向下取整')
  check(graphqlCostOf(JSON.stringify({ rateLimit: { cost: -1 } })) === 0, 'A、负数点数按 0，不写进账本')
  check(JSON.stringify(ghArgsOf(['gh', 'api', 'graphql', '-f', 'query=query{}'])) === JSON.stringify(['api', 'graphql', '-f', 'query=query{}']),
    'A、整条 argv 去掉程序名后就是子命令参数')
  check(JSON.stringify(ghArgsOf(['C:\\bin\\gh.exe', 'issue', 'list'])) === JSON.stringify(['issue', 'list']),
    'A、带目录的 gh.exe 也只去掉第一段')
  check(JSON.stringify(ghArgsOf(['api', 'graphql', '-f', 'query=query{}'])) === JSON.stringify(['api', 'graphql', '-f', 'query=query{}']),
    'A、已经剥过程序名的参数原样返回（#1482 复审：再剥一次会把 api 吃掉，GraphQL 又记成 REST）')
  check(JSON.stringify(ghArgsOf(['glab', 'api', 'projects'])) === JSON.stringify(['glab', 'api', 'projects']),
    'A、不是 gh 的命令不去第一段（GitLab 的 argv 不能被误剥）')
  check(Array.isArray(ghArgsOf([])) && ghArgsOf([]).length === 0, 'A、空 argv 回空数组')
  check(ghOutboundEntryOf(['api', 'graphql']).requests === 0 && ghOutboundEntryOf(['api', 'graphql']).points === 1,
    'A、起进程前 GraphQL 记 0 条 REST 请求、1 点')
  check(ghOutboundEntryOf(['api', 'repos/o/n']).requests === 1 && ghOutboundEntryOf(['api', 'repos/o/n']).points === 0,
    'A、起进程前 REST 记 1 条请求、0 点')
  const fix5 = graphqlCorrectionOf(['api', 'graphql'], gqlOut(5))
  check(!!fix5 && fix5.requests === 0 && fix5.points === 4, 'A、cost=5 时补差点数 4、请求仍 0')
  check(graphqlCorrectionOf(['api', 'graphql'], gqlOut(1)) === null, 'A、cost=1 时没有差额，不补')
  check(graphqlCorrectionOf(['api', 'repos/o/n'], gqlOut(5)) === null, 'A、REST 命令不补点数')
  const note5 = ghPointNoteOf(['api', 'graphql'], gqlOut(5))
  check(note5.points === 5 && note5.pointSource === 'server', 'A、日志点数：回包给了 cost 就记真实点数与 server')
  const noteEst = ghPointNoteOf(['api', 'graphql'])
  check(noteEst.points === 1 && noteEst.pointSource === 'estimate', 'A、日志点数：没拿到回包时按 1 点估并标 estimate')
  const noteRest = ghPointNoteOf(['api', 'repos/o/n'], '[]')
  check(noteRest.points === 0 && noteRest.pointSource === '', 'A、日志点数：REST 记 0 点、来源空串')
}

// ---------------- B. 客户端：报闸、补差、操作信封 ----------------
async function partB(): Promise<void> {
  console.log('== B、客户端报给闸与操作信封的用量 ==')
  {
    // GraphQL 一页，回包说这一页真实花了 5 点。
    const box = collectorOf()
    const c = ghClient(ctxOf(gqlOut(5), box.gate))
    const res = await c.execGh(['api', 'graphql', '-f', 'query=query{rateLimit{cost}}'])
    check(!!res && res.ok === true, 'B、GraphQL 这一笔跑成功')
    check(box.calls.length === 2, 'B、GraphQL 报两次账（先报闸、后补差）', box.calls.length)
    const first = box.calls[0] || []
    check(first[0] === 'out' && first[1] && first[1].requests === 0 && first[1].points === 1,
      'B、先报闸：0 条 REST 请求、按 1 点估', JSON.stringify(first[1]))
    const second = box.calls[1] || []
    check(second[0] === 'fix' && second[1] && second[1].requests === 0 && second[1].points === 4,
      'B、补差：只补点数（cost 5 − 估算 1 = 4），请求仍 0', JSON.stringify(second[1]))
    check(c.usage.requests === 0 && c.usage.points === 5,
      'B、客户端自己的计数：0 条请求、5 点', JSON.stringify(c.usage))
  }
  {
    // 回包 cost 就是 1：不需要补差。
    const box = collectorOf()
    const c = ghClient(ctxOf(gqlOut(1), box.gate))
    await c.execGh(['api', 'graphql', '-f', 'query=query{}'])
    check(box.calls.length === 1, 'B、cost=1 时不补差（只报一次闸）', box.calls.length)
    check(c.usage.requests === 0 && c.usage.points === 1, 'B、cost=1 时客户端记 1 点', JSON.stringify(c.usage))
  }
  {
    // 回包里读不到点数：沿用 1 点估算，不补差也不报错。
    const box = collectorOf()
    const c = ghClient(ctxOf('{"data":{}}', box.gate))
    const res = await c.execGh(['api', 'graphql', '-f', 'query=query{}'])
    check(!!res && res.ok === true && box.calls.length === 1 && c.usage.points === 1,
      'B、读不到点数时按 1 点估、不补差', JSON.stringify(c.usage))
  }
  {
    // 控制组：真 REST 请求仍然记 1 条，不许被这次改动顺手改成 0。
    const box = collectorOf()
    const c = ghClient(ctxOf('[]', box.gate))
    await c.execGh(['api', 'repos/o/n/issues?page=1'])
    check(box.calls.length === 1 && box.calls[0][1].requests === 1 && box.calls[0][1].points === 0,
      'B、REST 请求照旧记 1 条请求、0 点', JSON.stringify(box.calls[0] && box.calls[0][1]))
    check(c.usage.requests === 1 && c.usage.points === 0, 'B、REST 控制组客户端计数 1 条', JSON.stringify(c.usage))
  }
  {
    // 一次操作（操作表外层包起来看信封）：GraphQL 的最终用量是 0 条 5 点。
    const box = collectorOf()
    const c = ghClient(ctxOf(gqlOut(5), box.gate))
    const table: any = attachOpUsage({ listPage: function (): any { return c.execGh(['api', 'graphql', '-f', 'query=query{}']) } })
    const env = await table.listPage()
    check(!!env && env.ok === true && env.usage && env.usage.requests === 0 && env.usage.points === 5,
      'B、操作信封里是最终用量：0 条请求、5 点', JSON.stringify(env && env.usage))
  }
}

// ---------------- C. 记账口：双桶账本只按点数记 ----------------
async function partC(): Promise<void> {
  console.log('== C、双桶账本：rest 桶不再被 GraphQL 虚增 ==')
  const TWO = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }
  const usage = function (requests: number, points: number): any {
    return { ok: true, usage: { requests: requests, points: points }, data: {} }
  }
  {
    // 修复后的 GraphQL 信封：0 条请求、5 点。
    const l: any = createLedger({ now: function (): number { return CLOCK } })
    const port: any = createAccountPort({ ledger: l, account: 'ai-tool' })
    await port({ op: 'list', budget: TWO, result: usage(0, 5), backendId: 'github' })
    const rest: any = l.hour('ai-tool', 'github/rest')
    const gql: any = l.hour('ai-tool', 'github/graphql')
    check(rest.requests === 0 && gql.points === 5,
      'C、GraphQL 一笔只进 graphql 桶（5 点），rest 桶 0 条', JSON.stringify({ rest: rest.requests, points: gql.points }))
    check(l.snapshot().total.requests === 0 && l.snapshot().total.points === 5,
      'C、总账也是 0 条请求、5 点', JSON.stringify(l.snapshot().total))
  }
  {
    // 控制组：真 REST 请求照旧进 rest 桶。
    const l: any = createLedger({ now: function (): number { return CLOCK } })
    const port: any = createAccountPort({ ledger: l, account: 'ai-tool' })
    await port({ op: 'list', budget: TWO, result: usage(1, 0), backendId: 'github' })
    check(l.hour('ai-tool', 'github/rest').requests === 1 && l.hour('ai-tool', 'github/graphql').points === 0,
      'C、REST 控制组：1 条请求进 rest 桶、graphql 0 点')
  }
  {
    // 回归到旧口径（GraphQL 报 1 条请求）时账本会怎样：这里钉住旧口径确实会虚增，说明本门禁量的就是那件事。
    const l: any = createLedger({ now: function (): number { return CLOCK } })
    const port: any = createAccountPort({ ledger: l, account: 'ai-tool' })
    await port({ op: 'list', budget: TWO, result: usage(1, 1), backendId: 'github' })
    check(l.hour('ai-tool', 'github/rest').requests === 1,
      'C、对照：旧口径（GraphQL 当 1 条 REST）确实会把 rest 桶推高一条 —— 这正是 #1482 的现场')
  }
}

// ---------------- D. 闸：显式 0 条与补差口 ----------------
async function partD(): Promise<void> {
  console.log('== D、闸的统计口径：0 条不被抬成 1，补差能单独补点 ==')
  const l: any = createLedger({ now: function (): number { return CLOCK } })
  const g: any = createGate({ ledger: l, now: function (): number { return CLOCK } })
  const t1: any = g.noteOutbound({ requests: 0, points: 1 })
  check(t1.requests === 0 && t1.points === 1,
    'D、显式报 0 条时统计就是 0 条（旧写法 num(e.requests) || 1 会抬成 1）', JSON.stringify(t1))
  const t2: any = g.noteOutbound({})
  check(t2.requests === 1, 'D、没给条数时仍按 1 条兜底（旧调用点行为不变）', JSON.stringify(t2))
  const t3: any = g.noteOutboundCorrection({ requests: 0, points: 4 })
  check(t3.requests === 1 && t3.points === 5,
    'D、补差口只加点数：累计 0+1 条、1+4 点', JSON.stringify(t3))
  const t4: any = g.noteOutboundCorrection({})
  check(t4.requests === 1 && t4.points === 5, 'D、补差口缺省不改变累计', JSON.stringify(t4))
  const st: any = g.stats()
  check(st.transport.requests === 1 && st.transport.points === 5,
    'D、闸的对账统计与逐次返回一致', JSON.stringify(st.transport))

  // 步计数器：一步之内先估 1 点、再补 4 点，这一步的真实花费是 5 点、0 条请求。
  const m: any = await measureStep(async function (): Promise<string> {
    noteStepOutbound({ requests: 0, points: 1 })
    noteStepOutbound({ requests: 0, points: 4 })
    return 'done'
  })
  check(m.result === 'done' && m.actual.requests === 0 && m.actual.points === 5,
    'D、步计数器：0 条请求、5 点（估 1 补 4 合起来）', JSON.stringify(m.actual))
  const m2: any = await measureStep(async function (): Promise<string> {
    noteStepOutbound({})
    return 'x'
  })
  check(m2.actual.requests === 1, 'D、步计数器：没给条数仍按 1 条兜底', JSON.stringify(m2.actual))
}

// ---------------- E. 查询文本 ----------------
function partE(): void {
  console.log('== E、每条读查询都取 rateLimit{ cost } ==')
  const queries: any[] = [
    ['LIST_QUERY', Q.LIST_QUERY],
    ['GET_QUERY', Q.GET_QUERY],
    ['getIssueQuery(50,false)', Q.getIssueQuery(50, false)],
    ['getIssueQuery(50,true)', Q.getIssueQuery(50, true)],
    ['DEPS_QUERY', Q.DEPS_QUERY],
    ['COUNTS_QUERY', Q.COUNTS_QUERY],
    ['COUNTS_QUERY_WITH_LABELS', Q.COUNTS_QUERY_WITH_LABELS],
    ['LIST_PAGE_QUERY', Q.LIST_PAGE_QUERY],
    ['LIST_PAGE_QUERY_WITH_LABELS', Q.LIST_PAGE_QUERY_WITH_LABELS],
    ['SUB_ISSUES_QUERY', Q.SUB_ISSUES_QUERY],
    ['LIST_PR_QUERY', Q.LIST_PR_QUERY],
    ['GET_PR_QUERY', Q.GET_PR_QUERY],
  ]
  let missing: string[] = []
  for (const row of queries) {
    if (String(row[1]).indexOf('rateLimit{ cost }') < 0) missing.push(row[0])
  }
  check(missing.length === 0, 'E、12 份读查询都在 Query 根带 rateLimit{ cost }（缺的：' + (missing.join('、') || '无') + '）')
  check(Q.ADD_BLOCKED_BY_MUTATION.indexOf('rateLimit') < 0 && Q.REMOVE_BLOCKED_BY_MUTATION.indexOf('rateLimit') < 0,
    'E、两份 mutation 不带 rateLimit（mutation 拿不到 cost，仍按 1 点估）')
}

// ---------------- F. 四条出站路径不再各写各的判档 ----------------
function partF(): void {
  console.log('== F、四条出站路径都走共享判档（防回退扫描） ==')
  const outboundTiers = srcOf('src/tracker/kernel/outbound-tiers.ts')
  check(outboundTiers.indexOf('export function isGraphqlGhArgs') >= 0 && outboundTiers.indexOf('export function graphqlCostOf') >= 0,
    'F、共享层导出判档与取点两个函数（判档只有一处定义）')
  check(outboundTiers.indexOf('export function ghArgsOf(') >= 0 && outboundTiers.indexOf('export function ghOutboundEntryOf(') >= 0 &&
    outboundTiers.indexOf('export function graphqlCorrectionOf(') >= 0 && outboundTiers.indexOf('export function ghPointNoteOf(') >= 0,
    'F、剥程序名、起进程前报什么、事后补多少、日志点数来源四份口径各只一层')
  check(outboundTiers.indexOf("parts[0] === 'graphql'") < 0,
    'F、不再留「第一段就是 graphql」这条没人调用的支路')
  check(outboundTiers.indexOf('const GRAPHQL_ESTIMATE_POINTS = 1') >= 0,
    'F、GraphQL 估算点数只有一处定义')

  const client = srcOf('src/tracker/rooms/github/client.ts')
  // gh.exec / gh.timeout 两条日志的字段拼装与 NOT_ACCOUNTED 已按文件粒度上限拆到 client-support.ts，
  // 判据仍按「这两份合起来必须有」来判：拆文件不该让防回退扫描漏掉日志点。
  const clientSupport = srcOf('src/tracker/rooms/github/client-support.ts')
  const clientParts = client + '\n' + clientSupport
  check(client.indexOf('ghOutboundEntryOf(args)') >= 0 && client.indexOf('graphqlCorrectionOf(args, stdout)') >= 0,
    'F、gh 客户端报闸与补差都用共享口径，不再自己算一条请求/一点')
  check(clientParts.indexOf('ghPointNoteOf(args, stdout)') >= 0 && clientParts.indexOf('points: pointNote.points') >= 0,
    'F、gh 客户端把真实点数与来源写进 gh.exec 日志（#1482 补的日志点）')
  check(clientParts.indexOf("const NOT_ACCOUNTED = { points: 0, pointSource: '' }") >= 0 &&
    client.indexOf("phase === 'queue' ? NOT_ACCOUNTED : ghPointNoteOf(args)") >= 0,
    'F、报闸之前的 gh.exec 行写 0 点与空来源（排队取消、执行器没接上时不假装已记账）')
  check(client.indexOf("indexOf('graphql')") < 0 && client.indexOf('String(args && args[0]') < 0,
    'F、gh 客户端里旧的「只看第一段」写法已删')

  const gate = srcOf('src/refresh/rooms/host/refresh-gate.ts')
  check(gate.indexOf('function noteOutboundCorrection') >= 0 && gate.indexOf('noteOutboundCorrection: noteOutboundCorrection') >= 0,
    'F、闸对外暴露补差口')
  check(gate.indexOf('num(e.requests) || 1') < 0, 'F、闸的报账口不再把显式 0 条抬成 1 条')

  // #1482：两个报账口的累计口径从闸里抽到 transport-ledger.ts（闸已贴着有效行上限）。
  const ledger = srcOf('src/refresh/kernel/transport-ledger.ts')
  check(ledger.indexOf('export function addOutbound(') >= 0 && ledger.indexOf('export function addOutboundCorrection(') >= 0,
    'F、先报闸与事后补差两个口径各有一个出口（条数缺省按 1 兜底 / 补差按字面收 0）')

  const step = srcOf('src/refresh/kernel/step-pricing.ts')
  check(step.indexOf('num(e.requests) || 1') < 0, 'F、步计数器同样不再把显式 0 条抬成 1 条')

  const platform = srcOf('src/host/platformChannel.ts')
  check(platform.indexOf('reportGhOutbound(gateOf(), args)') >= 0 && platform.indexOf('noteGhGraphqlCorrection(deGate, args') >= 0,
    'F、平台通道（面板写路径）报闸与事后补差都走共享模块，不再自己判 GraphQL')

  const gitExec = srcOf('src/refresh/rooms/host/git-execution.ts')
  check(gitExec.indexOf('ghOutboundEntryOf(ghArgsOf(argv))') >= 0 && gitExec.indexOf('noteGhGraphqlCorrection(xpGate, ghArgsOf(argv), 0, out.text') >= 0,
    'F、旧面板写路径同样按共享口径报闸，并在成功后补差（同一条命令两条出口点数一致）')
  check(gitExec.indexOf("String(args && args[0]) === 'api'") < 0 && gitExec.indexOf('isGraphqlGhArgs(') < 0,
    'F、旧面板里自己判 GraphQL 的写法已删')
}

async function main(): Promise<void> {
  partA()
  await partB()
  await partC()
  await partD()
  partE()
  partF()
}

main().then(function (): void {
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  if (failed) process.exitCode = 1
}).catch(function (e: any): void {
  console.log('FAIL：门禁自己抛错 —— ' + String((e && e.stack) || e))
  process.exitCode = 1
})
