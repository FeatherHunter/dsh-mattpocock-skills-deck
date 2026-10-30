import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.ts'
// tests/verify-1304-deps-native.ts —— #1304 反向阻塞边专属门禁（不联网，桩照真机回包形状）
//
// 这张票要修的四件事，一条门禁一条：
//   ① 缺省读一张票时，反向阻塞边（谁被这张票阻塞）走的是后端的原生字段，一次查询同时拿回
//      正向与反向边，标题与状态随行返回 —— 不再整仓扫描，也不再逐张再读一遍标题。
//   ② 原生连接到了后端给的上限（50 条）时，回执必须自己说「可能不全」，不许把「没看到」当「没有」。
//   ③ 原生字段不可用（老版本、非 GitHub、查询失败）时退回整仓列表反推，但这条路一旦用了，
//      回执必须交代「用了兜底」，列表被截断时还要说「不全」。
//   ④ 被上限截断的整仓列表不许再被当成「完整名册」收下：名册的 complete 位必须保持 false，
//      否则下一次读边会拿一份少了一半票的索引去算「谁被阻塞」。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1304-deps-native.ts

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)

let failed = false
let total = 0
function check(ok: boolean, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const REPO = { backend: 'github', refId: 'o/r', name: 'r', url: '' }
const K = '714'

/** 一页票的形状：真机 GraphQL 列表节点归一后长这样（缺字段会被归一补空，这里照实给够）。 */
function row(number: number, title: string, blockedByNodes: any[] = []): any {
  return {
    number: number,
    title: title,
    state: 'OPEN',
    body: '',
    url: 'https://github.com/o/r/issues/' + number,
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
    closedAt: null,
    author: { login: 'a' },
    assignees: { nodes: [] },
    labels: { nodes: [] },
    milestone: null,
    comments: { nodes: [] },
    parent: null,
    blockedBy: { nodes: blockedByNodes },
  }
}

/** 原生依赖查询的回包：一次给齐正向与反向两条连接。 */
function nativeBody(opts: { blockedBy?: any[]; blocking?: any[]; blockingMore?: boolean; blockedByMore?: boolean } = {}): any {
  const o = opts
  return {
    data: {
      repository: {
        issue: {
          number: Number(K),
          blockedBy: { pageInfo: { hasNextPage: o.blockedByMore === true }, nodes: o.blockedBy || [] },
          blocking: { pageInfo: { hasNextPage: o.blockingMore === true }, nodes: o.blocking || [] },
        },
      },
    },
  }
}

/** 这一趟落下的 read.degraded（进程边界/持久化边界之外，依赖读路的降级结论线）。 */
function degradedEventsOf(ctx: any): any[] {
  return (ctx.events || []).filter((e: any) => e.event === 'read.degraded')
}

/**
 * 假 GitHub：只认三类查询，未预料到的请求一律记下来并回失败（严格桩，不替调用方兜底）。
 * routes 里的每一项：'ok' 的场合给回包对象，'fail' 的场合回一条命令行错误。
 */
function makeStub(routes: any) {
  const calls: any[] = []
  const unscripted: string[] = []
  let listPageNo = 0
  const exec = async (_cmd: string, args: string[], opts?: any) => {
    const line = args.join(' ')
    calls.push({ line: line, via: opts && opts.via })
    if (line.includes('blocking(first:50)')) {
      const r = routes.deps
      if (r === 'fail') return { code: 1, stdout: '', stderr: 'HTTP 502: graphql unavailable' }
      if (r === 'errors') return { code: 0, stdout: JSON.stringify({ errors: [{ message: 'Field blocking does not exist on type Issue' }] }), stderr: '' }
      return { code: 0, stdout: JSON.stringify(r), stderr: '' }
    }
    if (line.includes('pullRequests(')) {
      const r = routes.prs || { data: { repository: { pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] } } } }
      return { code: 0, stdout: JSON.stringify(r), stderr: '' }
    }
    if (line.includes('issues(first')) {
      const r = routes.list
      if (r === 'fail') return { code: 1, stdout: '', stderr: 'HTTP 403: API rate limit exceeded' }
      // 分页桩：routes.list 给函数时按第几页现造回包，免得每页都长一样（重复行会把反推结果撑出重复项）。
      const body = typeof r === 'function' ? r(listPageNo) : r
      listPageNo += 1
      return { code: 0, stdout: JSON.stringify(body), stderr: '' }
    }
    if (line.includes('issue(number:')) {
      const r = routes.get
      if (r === 'fail') return { code: 1, stdout: '', stderr: 'HTTP 404: not found' }
      return { code: 0, stdout: JSON.stringify(r), stderr: '' }
    }
    unscripted.push(line)
    return { code: 1, stdout: '', stderr: 'strict-fake unscripted: ' + line }
  }
  return { exec: exec, calls: calls, unscripted: unscripted }
}

function makeCtx(stub: any, memo?: any) {
  // via 标签不落 exec 的 opts，而是房内自己往 gh.exec 这条日志里记（client.ts 的 emitGhExec）；
  // 所以桩要在 logEvent 这一格上收，才能验到「这次查询带的是哪个标签」。
  const events: any[] = []
  return {
    cwd: '/ws/demo',
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async (n: string) => (n === 'gh' ? '/usr/bin/gh' : null), path: path.posix, env: { get: () => undefined } },
    exec: async (cmd: string, args: string[], opts: unknown) => stub.exec(cmd, args, opts),
    isEnabled: (name: string) => name === 'info',
    logEvent: (level: string, event: string, fields: any) => { events.push({ level: level, event: event, fields: fields }) },
    memo: memo || {},
    events: events,
  }
}

async function main() {
  console.log('#1304 反向阻塞边门禁：原生一次取回 + 截断自曝 + 兜底自曝 + 名册不把截断当完整')
  const graph = await imp('src/tracker/rooms/github/write/graph.ts')

  // ── S1 原生路：一次查询拿回正向与反向边，标题状态随行，不再整仓扫描、不再逐条读标题 ──
  {
    const stub = makeStub({
      deps: nativeBody({ blockedBy: [{ number: 718, title: '前一张票', state: 'CLOSED' }], blocking: [{ number: 721, title: '阻塞者甲', state: 'OPEN' }] }),
    })
    const ctx = makeCtx(stub)
    const r = await graph.getDependencies(REPO, K, {}, ctx)
    check(r.ok === true, 'S1-1 原生路成功（实得 ok=' + r.ok + ' ' + String((r.error && r.error.message) || '') + '）')
    const d = r.ok ? r.data : {}
    check(d.blockingSource === 'native', 'S1-2 回执交代来源是原生字段（实得 ' + d.blockingSource + '）')
    check(d.blockingComplete === true, 'S1-3 连接没到上限就说完整（实得 ' + d.blockingComplete + '）')
    const bk = (d.blocking || []).map((b: any) => String(b.key)).sort().join(',')
    check(bk === '721', 'S1-4 反向边拿回 721（实得 ' + bk + '）')
    check((d.blocking || [])[0] && d.blocking[0].title === '阻塞者甲' && d.blocking[0].state === 'open', 'S1-5 标题与状态随同一次查询回来（实得 ' + JSON.stringify((d.blocking || [])[0]) + '）')
    check((d.blockedBy || []).length === 1 && d.blockedBy[0].key === '718' && d.blockedBy[0].state === 'closed', 'S1-6 正向边也一起回来，状态归一正确（实得 ' + JSON.stringify(d.blockedBy) + '）')
    check(stub.calls.length === 1, 'S1-7 整趟只有一次远端查询（实得 ' + stub.calls.length + '：' + stub.calls.map((c: any) => c.line.slice(0, 60)).join(' | ') + '）')
    const viaTags = ctx.events.filter((e: any) => e.event === 'gh.exec').map((e: any) => String(e.fields && e.fields.via))
    check(viaTags.indexOf('deps.gql') >= 0, 'S1-8 这次调用带 deps.gql 标签（实得 ' + JSON.stringify(viaTags) + '）')
    check(stub.unscripted.length === 0, 'S1-9 桩里没有未预料到的请求')
    check(degradedEventsOf(ctx).length === 0, 'S1-10 完整且走原生的一趟不落 read.degraded（实得 ' + degradedEventsOf(ctx).length + ' 行）')
  }

  // ── S2 原生连接到了上限：已给的条目照返回，但必须自曝「可能不全」；正向边同样要自曝 ──
  {
    const stub = makeStub({
      deps: nativeBody({
        blockedBy: [{ number: 718, title: '前一张票', state: 'CLOSED' }],
        blocking: [{ number: 721, title: '阻塞者甲', state: 'OPEN' }],
        blockingMore: true,
        blockedByMore: true,
      }),
    })
    const ctx = makeCtx(stub)
    const r = await graph.getDependencies(REPO, K, {}, ctx)
    check(r.ok === true, 'S2-1 连接截断不算失败，已给的条目照返回（实得 ok=' + r.ok + '）')
    const d = r.ok ? r.data : {}
    check(d.blockingComplete === false, 'S2-2 到了上限就标「不全」（实得 ' + d.blockingComplete + '）')
    check(typeof d.blockingNote === 'string' && d.blockingNote.indexOf('不全') >= 0, 'S2-3 注记自己说清可能不全（实得 ' + String(d.blockingNote) + '）')
    check((d.blocking || []).length === 1, 'S2-4 已给的那条没有被吞掉')
    check(d.blockedByComplete === false, 'S2-5 正向边被截断也要标「不全」（实得 ' + d.blockedByComplete + '）')
    check(typeof d.blockingNote === 'string' && d.blockingNote.indexOf('被谁阻塞') >= 0, 'S2-6 注记同时说清正向边也到了上限（实得 ' + String(d.blockingNote) + '）')
    const ev = degradedEventsOf(ctx)
    check(ev.length === 1 && ev[0].fields && ev[0].fields.op === 'deps' && ev[0].fields.reason === 'deps:truncated', 'S2-7 截断落一行 read.degraded（实得 ' + JSON.stringify(ev.map((e: any) => e.fields)) + '）')
  }

  // ── S3 原生字段不可用（GraphQL 回 errors）→ 退回整仓列表反推；列表被截断时要自曝「不全」，且不逐条再读标题 ──
  {
    // 整仓列表：每页 100 行、一直说还有下一页，列表房到 500 条就停（这是它的安全上限）。
    const page = (no: number): any => {
      const nodes: any[] = []
      for (let i = 0; i < 100; i += 1) {
        // 只有第一页有那一条反向边；其余页是无关票（同一页重复五遍会让反推结果重复五次）。
        if (no === 0 && i === 0) nodes.push(row(900, '阻塞者乙', [{ number: Number(K), title: '被阻塞的票', state: 'OPEN' }]))
        else nodes.push(row(9000 + no * 100 + i, '无关票' + no + '-' + i))
      }
      return { data: { repository: { issues: { pageInfo: { hasNextPage: true, endCursor: 'c' + no }, nodes: nodes } } } }
    }
    const stub = makeStub({
      deps: 'errors',
      get: { data: { repository: { issue: row(Number(K), '目标票') } } },
      list: page,
    })
    const memo: any = {}
    const ctx = makeCtx(stub, memo)
    const r = await graph.getDependencies(REPO, K, {}, ctx)
    check(r.ok === true, 'S3-1 原生不可用时退回整仓反推，照样回成功（实得 ok=' + r.ok + ' ' + String((r.error && r.error.message) || '') + '）')
    const d = r.ok ? r.data : {}
    check(d.blockingSource === 'scan', 'S3-2 回执交代用了整仓兜底（实得 ' + d.blockingSource + '）')
    check(d.blockingComplete === false, 'S3-3 列表被截断就标「不全」（实得 ' + d.blockingComplete + '）')
    check(typeof d.blockingNote === 'string' && d.blockingNote.indexOf('不全') >= 0 && d.blockingNote.indexOf('反推') >= 0, 'S3-4 注记说清「用了兜底」与「可能不全」（实得 ' + String(d.blockingNote) + '）')
    const bk = (d.blocking || []).map((b: any) => String(b.key)).sort().join(',')
    check(bk === '900', 'S3-5 用列表行本身反推出阻塞者 900（实得 ' + bk + '）')
    check((d.blocking || [])[0] && d.blocking[0].title === '阻塞者乙', 'S3-6 阻塞者标题直接取列表行，不再逐张读一遍（实得 ' + JSON.stringify((d.blocking || [])[0]) + '）')
    const getCalls = stub.calls.filter((c: any) => c.line.includes('issue(number:') && !c.line.includes('blocking(first:50)')).length
    check(getCalls === 1, 'S3-7 只读了目标票本身一次，没有逐条读标题的 N+1（实得 ' + getCalls + ' 次单票读）')
    check(!!memo.roster && memo.roster.complete !== true, 'S3-8 截断列表没有把名册标成完整（实得 complete=' + String(memo.roster && memo.roster.complete) + '）')
    check(stub.unscripted.length === 0, 'S3-9 桩里没有未预料到的请求（' + stub.unscripted.join(' | ').slice(0, 120) + '）')
    // 列表房自己也会落一行 list:partial（那是它的降级结论），这里只看依赖这一条路落的行。
    const ev = degradedEventsOf(ctx).filter((e: any) => e.fields && e.fields.op === 'deps')
    check(ev.length === 1 && ev[0].fields.reason === 'deps:truncated', 'S3-10 兜底且列表被截断也落一行 read.degraded（实得 ' + JSON.stringify(degradedEventsOf(ctx).map((e: any) => e.fields)) + '）')
  }

  // ── S4 兜底这条路本身：原生不可用、列表完整时，结果标完整，但注记要说明用了兜底 ──
  {
    const stub = makeStub({
      deps: 'fail',
      get: { data: { repository: { issue: row(Number(K), '目标票') } } },
      list: { data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [row(Number(K), '目标票'), row(900, '阻塞者丙', [{ number: Number(K), title: '被阻塞的票', state: 'OPEN' }])] } } } },
      prs: { data: { repository: { pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] } } } },
    })
    const ctx = makeCtx(stub)
    const r = await graph.getDependencies(REPO, K, {}, ctx)
    const d = r.ok ? r.data : {}
    check(r.ok === true && d.blockingSource === 'scan', 'S4-1 兜底路成功且交代来源（实得 ok=' + r.ok + ' source=' + d.blockingSource + '）')
    check(d.blockingComplete === true, 'S4-2 列表完整就标完整（实得 ' + d.blockingComplete + '）')
    check(typeof d.blockingNote === 'string' && d.blockingNote.indexOf('反推') >= 0 && d.blockingNote.indexOf('不全') < 0, 'S4-3 注记说明用了兜底，但不说「不全」（实得 ' + String(d.blockingNote) + '）')
    check((d.blocking || []).length === 1 && d.blocking[0].title === '阻塞者丙', 'S4-4 标题取自列表行（实得 ' + JSON.stringify(d.blocking) + '）')
    const ev = degradedEventsOf(ctx)
    check(ev.length === 1 && ev[0].fields && ev[0].fields.reason === 'deps:shape', 'S4-5 兜底但结果完整时也留一行，原因为 deps:shape（实得 ' + JSON.stringify(ev.map((e: any) => e.fields)) + '）')
  }

  // ── S5 没有依赖边的仓库：原生回空连接，成功且完整，不许报错 ──
  {
    const stub = makeStub({ deps: nativeBody({}) })
    const ctx = makeCtx(stub)
    const r = await graph.getDependencies(REPO, K, {}, ctx)
    const d = r.ok ? r.data : {}
    check(r.ok === true, 'S5-1 没有依赖边的票照样读成功（实得 ok=' + r.ok + '）')
    check((d.blockedBy || []).length === 0 && (d.blocking || []).length === 0, 'S5-2 两边都是空数组，不是缺字段')
    check(d.blockingComplete === true && d.blockingSource === 'native', 'S5-3 空结果也说清来源与完整性')
    check(degradedEventsOf(ctx).length === 0, 'S5-4 完整的空结果不落 read.degraded')
  }

  // ── S6 取消 blocking=false 的语义不在后端：那一条由工具层跳过，后端这里仍照常回原生字段 ──
  // （工具层不调 getDependencies 这一支由 tests/verify-deck-thin-reads.ts 管，这里只确认后端函数本身没有分支改动。）

  // ── S7 壳层名册完整位（AC⑤，评审补）：REST 降级与截断的列表都不许被标成完整名册 ──
  // 房间层把「不全」交给调用方（issues.ts 的 truncated / fallback）；壳层若只认 truncated，
  // REST 回包没有这格时就会把名册标成 complete，成环检查会拿一份子集判「没有环」。
  {
    const shellMod = await imp('src/refresh/rooms/host/tool-call-budget-enforcement.ts')
    const fakeBackend = (out: any) => ({ list: async () => out })
    const issueRow = (n: number) => ({ key: String(n), title: '票' + n, state: 'open', type: 'issue', labels: [], assignees: [], blockedBy: [] })
    const normal = shellMod.withCallScope({ tracker: fakeBackend({ ok: true, data: [issueRow(1)] }) })
    await normal.tracker.list(REPO, {}, normal.opCtx)
    check(normal.memo.roster.complete === true, 'S7-1 完整列表照旧收成完整名册（实得 ' + String(normal.memo.roster.complete) + '）')
    const rest = shellMod.withCallScope({ tracker: fakeBackend({ ok: true, data: [issueRow(1)], fallback: 'rest', fallbackReason: 'other' }) })
    await rest.tracker.list(REPO, {}, rest.opCtx)
    check(rest.memo.roster.complete !== true, 'S7-2 走 REST 降级的列表不得标成完整名册（实得 ' + String(rest.memo.roster.complete) + '）')
    const trunc = shellMod.withCallScope({ tracker: fakeBackend({ ok: true, data: [issueRow(1)], truncated: true }) })
    await trunc.tracker.list(REPO, {}, trunc.opCtx)
    check(trunc.memo.roster.complete !== true, 'S7-3 被上限截断的列表不得标成完整名册（实得 ' + String(trunc.memo.roster.complete) + '）')
  }

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
