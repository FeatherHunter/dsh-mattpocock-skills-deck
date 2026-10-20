import { createOutboundControl } from '../src/host/platform/outbound-control.ts'
// tests/verify-1054-edge-graph.ts —— #1054 关系与边专属门禁（不联网）
//
// 测什么（两件事，缺一不可）：
//
//   一、#1100 现象 2 的修复：写阻塞边之前的「对账」不再只看契约字段。
//       契约字段（GraphQL 的 blockedBy）在 GraphQL 拿不到、读路径退回 REST 时是空的
//       （REST 单票与列表回包都不带父子与阻塞边）。差集于是退化成全集：已经存在的边会被
//       再 POST 一遍，上游回 422 already been taken，这一批边一条都落不下去。现在先直接问
//       原生接口拿真值（问不到才退回契约老口径），只提交真正的差集；就算上游仍报
//       already been taken，也只当「这条边已在位」，不再把这一批剩下的边一起丢掉。
//
//   二、四个新事件真发得出来，字段就是附录登记的那些（#100 edge.write 常驻，
//       #101 edge.cycle / #102 edge.roster / #103 edge.repair 按需，开关关掉时一行不发）。
//
// 桩是「一台只认数据库编号的假 GitHub」：原生依赖边端点、数据库编号查询、GraphQL 读票三件事，
// 形状照真机写（POST 传的是数据库编号，重复边回 422，缺的边 DELETE 回 404），不替调用方兜底。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1054-edge-graph.ts

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
// 票面号与数据库编号是两回事：真机的写边接口只认数据库编号（-F 传数字）。
const DB = (n: unknown): number => 1000000 + Number(n)
const keyOfDb = (id: number): string => String(id - 1000000)

/** 桩的配置：一份原生真值，加几个「让它长得像真机某一种脾气」的开关。 */
interface StubOpts {
  blocked?: Record<string, string[]>
  contract?: Record<string, string[]> | null
  contractBlind?: boolean
  nativeGetFails?: boolean
  nativeBlind?: boolean
  deleteFails?: string[]
  subIssues?: Record<string, number[]>
  subIssuesFails?: string[]
  /**
   * GraphQL 边 mutation 在这台假 GitHub 上能不能用。
   * 默认 false：两个 mutation 字段回「不存在」，模拟 GHES 老版本 —— 老用例仍走 REST 兜底；
   * 只有显式打开 true 的桩才走 GraphQL 主路（S12 起）。
   */
  gqlWorks?: boolean
  /** 批量取 node id 的查询失败（模拟 GraphQL 端点不可用），用来验证「查不到 id 也回落 REST」。 */
  gqlIdsFail?: boolean
}

function makeState(o: StubOpts) {
  const src = o.blocked || {}
  const blocked = new Map<string, Set<string>>()
  for (const k of Object.keys(src)) blocked.set(k, new Set(src[k]))
  return {
    blocked,
    contract: o.contract ? new Map<string, string[]>(Object.entries(o.contract)) : null,
    contractBlind: o.contractBlind === true,
    nativeGetFails: o.nativeGetFails === true,
    nativeBlind: o.nativeBlind === true,
    deleteFails: new Set<string>(o.deleteFails || []),
    subIssues: new Map<string, number[]>(Object.entries(o.subIssues || {})),
    subIssuesFails: new Set<string>(o.subIssuesFails || []),
    allKeys: Object.keys(src),
    posts: [] as string[],
    // 真提交过的补边（上游点头的）与「提交这个动作本身」（含撞已在位被 422 挡下的）分开记：
    // 「有没有把已经在位的边再提交一遍」看的是后者，前者只回答「真落了几条」。
    attempts: [] as string[],
    deletes: [] as string[],
    nativeGets: 0,
    graphqlGets: 0,
    // GraphQL 主路这一轮的三本账：取过几次 node id、发过哪些边 mutation（形如 add:3 / remove:4）。
    gqlIds: 0,
    gqlMutations: [] as string[],
    gqlWorks: o.gqlWorks === true,
    gqlIdsFail: o.gqlIdsFail === true,
    unscripted: [] as string[],
  }
}
type Stub = ReturnType<typeof makeState>

function makeStub(state: Stub) {
  const exec = async (_cmd: string, args: string[]) => {
    const line = args.join(' ')
    // ① 原生阻塞边真值：GET .../dependencies/blocked_by?per_page=100
    let m = /^api repos\/o\/r\/issues\/(\d+)\/dependencies\/blocked_by\?per_page=100$/.exec(line)
    if (m) {
      state.nativeGets += 1
      if (state.nativeGetFails) return { code: 1, stdout: '', stderr: 'HTTP 500: Internal Server Error' }
      if (state.nativeBlind) return { code: 0, stdout: '[]', stderr: '' }
      const arr = Array.from(state.blocked.get(m[1]) || [])
      return { code: 0, stdout: JSON.stringify(arr.map((n) => ({ number: Number(n) }))), stderr: '' }
    }
    // ② 撤一条阻塞边（真机：这条边不在就回 404）
    m = /^api repos\/o\/r\/issues\/(\d+)\/dependencies\/blocked_by\/(\d+) --method DELETE$/.exec(line)
    if (m) {
      const k = m[1]
      const bk = keyOfDb(Number(m[2]))
      const set = state.blocked.get(k)
      if (state.deleteFails.has(bk) || !set || !set.has(bk)) return { code: 1, stdout: '', stderr: 'HTTP 404: Not Found' }
      set.delete(bk)
      state.deletes.push(bk)
      return { code: 0, stdout: '{}', stderr: '' }
    }
    // ③ 补一条阻塞边（真机：这条边已经在就回 422 already been taken）
    m = /^api repos\/o\/r\/issues\/(\d+)\/dependencies\/blocked_by --method POST -F issue_id=(\d+)$/.exec(line)
    if (m) {
      const k = m[1]
      const bk = keyOfDb(Number(m[2]))
      if (!state.allKeys.includes(bk)) return { code: 1, stdout: '', stderr: 'HTTP 422: Validation Failed: bad issue_id' }
      state.attempts.push(bk)
      let set = state.blocked.get(k)
      if (!set) { set = new Set<string>(); state.blocked.set(k, set) }
      if (set.has(bk)) return { code: 1, stdout: '', stderr: 'HTTP 422: Validation Failed: Target issue has already been taken' }
      set.add(bk)
      state.posts.push(bk)
      return { code: 0, stdout: '{}', stderr: '' }
    }
    // ④ 票号换数据库编号
    m = /^api repos\/o\/r\/issues\/(\d+) --jq \.id$/.exec(line)
    if (m) return { code: 0, stdout: String(DB(m[1])), stderr: '' }
    // ⑤ 地图票的子票列表（REST 树边修复用）
    m = /^api repos\/o\/r\/issues\/(\d+)\/sub_issues\?per_page=100$/.exec(line)
    if (m) {
      if (state.subIssuesFails.has(m[1])) return { code: 1, stdout: '', stderr: 'HTTP 500: Internal Server Error' }
      const kids = state.subIssues.get(m[1]) || []
      return { code: 0, stdout: JSON.stringify(kids.map((n) => ({ number: n }))), stderr: '' }
    }
    // ⑥ GraphQL：三个形状分开认 —— 批量取 node id、边 mutation、读票（契约字段就是读回来的那份）
    if (line.startsWith('api graphql')) {
      state.graphqlGets += 1
      // ⑥-0 依赖查询（#1304）：一次取回正向 blockedBy 与反向 blocking 两条连接。
      // 反向边就是「谁把我当阻塞方」，从同一份状态里反推，形状与真机一致（两条连接都带 pageInfo）。
      if (line.includes('blocking(first:50)')) {
        const dm = /number=(\d+)/.exec(line)
        if (!dm) return { code: 1, stdout: '', stderr: 'bad deps query: ' + line.slice(0, 160) }
        const dk = dm[1]
        // 契约读回是空的那一档（contractBlind）连原生依赖字段一起看不见，与本文件其它读票场景口径一致。
        // 名册里 blocked 那本账存的是 Set，contract 那本存的是数组：先归成数组再读，两种形状都认。
        const toArr = (v: unknown): string[] => (v instanceof Set ? Array.from(v as Set<string>) : Array.isArray(v) ? (v as string[]).map(String) : [])
        const src = state.contractBlind ? new Map<string, unknown>() : (state.contract || state.blocked)
        const blockedBy = toArr(src.get(dk))
        const blocking: string[] = []
        if (!state.contractBlind) {
          for (const [ik, v] of src) {
            if (ik !== dk && toArr(v).includes(dk)) blocking.push(ik)
          }
        }
        const conn = (arr: string[]) => ({
          pageInfo: { hasNextPage: false },
          nodes: arr.map((n) => ({ number: Number(n), title: 't' + n, state: 'OPEN' })),
        })
        return { code: 0, stdout: JSON.stringify({ data: { repository: { issue: { number: Number(dk), blockedBy: conn(blockedBy), blocking: conn(blocking) } } } }), stderr: '' }
      }
      // ⑥-1 批量取 node id：一条 query 里若干别名 i0/i1…（issueNodeIdsQuery 的形状）
      const aliases = Array.from(line.matchAll(/i(\d+):\s*issue\(number:(\d+)\)/g))
      if (aliases.length) {
        state.gqlIds += 1
        if (state.gqlIdsFail) return { code: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' }
        const repo: Record<string, { id: string }> = {}
        for (const a of aliases) repo['i' + a[1]] = { id: 'I_kw_' + a[2] }
        return { code: 0, stdout: JSON.stringify({ data: { repository: repo } }), stderr: '' }
      }
      // ⑥-2 边 mutation：默认回「字段不存在」（模拟 GHES 老版本，老用例仍走 REST 兜底）；
      // 显式 gqlWorks 的桩才真写，并同步改 state.blocked，让紧接着的读回与真机一致。
      const mut = /addBlockedBy\(input:\{issueId:\$issueId, blockingIssueId:\$blockingIssueId\}\)/.test(line)
        ? 'add'
        : (/removeBlockedBy\(input:\{issueId:\$issueId, blockingIssueId:\$blockingIssueId\}\)/.test(line) ? 'remove' : '')
      if (mut) {
        if (!state.gqlWorks) return { code: 0, stdout: JSON.stringify({ errors: [{ message: "Field '" + mut + 'BlockedBy' + "' doesn't exist on type 'Mutation'" }] }), stderr: '' }
        const im = /issueId=I_kw_(\d+)/.exec(line)
        const bm = /blockingIssueId=I_kw_(\d+)/.exec(line)
        if (!im || !bm) return { code: 1, stdout: '', stderr: 'bad mutation args: ' + line.slice(0, 160) }
        state.gqlMutations.push(mut + ':' + bm[1])
        let set = state.blocked.get(im[1])
        if (!set) { set = new Set<string>(); state.blocked.set(im[1], set) }
        if (mut === 'add') set.add(bm[1])
        else set.delete(bm[1])
        return { code: 0, stdout: JSON.stringify({ data: { [mut === 'add' ? 'addBlockedBy' : 'removeBlockedBy']: { clientMutationId: null } } }), stderr: '' }
      }
      // ⑥-3 读票：契约字段就是它读回来的那份（contractBlind 模拟读路径退回 REST 时的空字段）
      const nm = /number=(\d+)/.exec(line)
      const k = nm ? nm[1] : '0'
      let nodes: string[] = []
      if (state.contractBlind) nodes = []
      else if (state.contract) nodes = state.contract.get(k) || []
      else nodes = Array.from(state.blocked.get(k) || [])
      const row = {
        number: Number(k), title: 't' + k, state: 'OPEN', body: '', url: '',
        createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', closedAt: null,
        author: { login: 'a' }, assignees: { nodes: [] }, labels: { nodes: [] }, milestone: null,
        comments: { nodes: [] }, parent: null,
        blockedBy: { nodes: nodes.map((n) => ({ number: Number(n), title: '', state: 'OPEN' })) },
      }
      return { code: 0, stdout: JSON.stringify({ data: { repository: { issue: row } } }), stderr: '' }
    }
    state.unscripted.push(line)
    return { code: 1, stdout: '', stderr: 'strict-fake unscripted: ' + line }
  }
  return { exec }
}

/** 名册：调用上下文里那份「票关系已经拿全」的索引，有它就不再整仓拉取（生产由工具层建）。 */
function makeMemo(state: Stub) {
  const byKey = new Map<string, { blockedBy: string[]; parentKey: string }>()
  for (const k of state.allKeys) byKey.set(k, { blockedBy: Array.from(state.blocked.get(k) || []), parentKey: '' })
  return { roster: { complete: true, byKey }, dirty: new Set<string>() }
}

function makeCtx(stub: any, memo: any, log: any[], debugOn: boolean) {
  return {
    cwd: '/ws/demo',
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async (n: string) => (n === 'gh' ? '/usr/bin/gh' : null), path: path.posix, env: { get: () => undefined } },
    exec: async (cmd: string, args: string[], opts: unknown) => stub.exec(cmd, args, opts),
    isEnabled: (level: string) => (debugOn && level === 'debug') || level === 'info',
    logEvent: (level: string, event: string, fields: Record<string, unknown>) => { log.push({ level, event, fields }) },
    memo,
  }
}

const linesOf = (log: any[], event: string): any[] => log.filter((l) => l.event === event)
const lastOf = (log: any[], event: string): any => { const a = linesOf(log, event); return a[a.length - 1] }
const keysOf = (f: any): string => Object.keys(f || {}).sort().join(',')

/** 一次补边：状态 + 上下文都按这一趟新造，断言只看这一趟的账。 */
async function callSetBlockedBy(graph: any, state: Stub, target: string[], key = '1', debugOn = true) {
  const log: any[] = []
  const stub = makeStub(state)
  const ctx = makeCtx(stub, makeMemo(state), log, debugOn)
  const r = await graph.setBlockedBy(REPO, key, target, {}, ctx)
  return { r, log, state }
}

async function main() {
  console.log('#1054 关系与边门禁：写前对账只看真值 + 四个边事件（不联网，桩照真机形状）')
  const graph = await imp('src/tracker/rooms/github/graph.ts')

  // ── S1 核心修复：契约读回是空的（模拟 GraphQL 降级），原生真值看得见「2 已经在位」 ──
  {
    const state = makeState({ blocked: { '1': ['2'], '2': [], '3': [] }, contractBlind: true })
    const { r, log } = await callSetBlockedBy(graph, state, ['2', '3'])
    check(r.ok === true, 'S1-1 补边成功（实得 ok=' + r.ok + ' ' + String((r.error && r.error.message) || '') + '）')
    check(state.posts.join(',') === '3', 'S1-2 只提交真正缺的那条（3），已在位的 2 没有再 POST 一遍（提交动作 ' + (state.attempts.join(',') || '(空)') + '，真落 ' + (state.posts.join(',') || '(空)') + '）')
    check(state.attempts.join(',') === '3', 'S1-2b 已在位的那条连提交动作都没发生（实发 ' + (state.attempts.join(',') || '(空)') + '）')
    check(state.deletes.length === 0, 'S1-3 没有多余撤边（实发 ' + state.deletes.length + ' 条）')
    const got = ((r.data && r.data.blockedBy) || []).map((b: any) => String(b.key)).sort().join(',')
    check(got === '2,3', 'S1-4 读回两条边都在（实得 ' + got + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.kind === 'block' && w.fields.route === 'rest' && w.fields.ok === true && w.fields.added === 1 && w.fields.removed === 0 && w.fields.kept === 1 && w.fields.reason === 'diff',
      'S1-5 edge.write 记下这一趟的真实轨迹（' + JSON.stringify(w && w.fields) + '）')
    check(keysOf(w && w.fields) === 'added,kept,kind,latencyMs,ok,reason,removed,route', 'S1-6 edge.write 字段就是登记的那八个')
    const cy = lastOf(log, 'edge.cycle')
    check(!!cy && cy.fields.verdict === 'clear' && cy.fields.blockers === 2 && cy.fields.nodes >= 3, 'S1-7 edge.cycle 记下结论与票数（' + JSON.stringify(cy && cy.fields) + '）')
    check(keysOf(cy && cy.fields) === 'blockers,latencyMs,nodes,verdict', 'S1-8 edge.cycle 字段就是登记的那四个')
    const ro = lastOf(log, 'edge.roster')
    check(!!ro && ro.fields.source === 'roster' && ro.fields.complete === true, 'S1-9 edge.roster 记下来源是名册（' + JSON.stringify(ro && ro.fields) + '）')
    check(keysOf(ro && ro.fields) === 'complete,dirty,latencyMs,source', 'S1-10 edge.roster 字段就是登记的那四个')
    check(state.unscripted.length === 0, 'S1-11 桩里没有未预料到的请求（' + state.unscripted.join(' | ').slice(0, 120) + '）')
  }

  // ── S2 回归 #1100 的病灶本身：真值问不到、差集退化成全集，上游对已在位的边回 422 ──
  {
    const state = makeState({ blocked: { '1': ['2'], '2': [], '3': [] }, contractBlind: true, nativeBlind: true })
    const { r, log } = await callSetBlockedBy(graph, state, ['2', '3'])
    check(r.ok === true, 'S2-1 上游回 already been taken 时不再整批中止，这一批照样成功（实得 ok=' + r.ok + '）')
    check(state.attempts.join(',') === '2,3', 'S2-2 两条都提交了：第一条撞已在位被上游挡下，第二条照落（提交动作 ' + state.attempts.join(',') + '，真落 ' + (state.posts.join(',') || '(空)') + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.ok === true && w.fields.added === 1 && w.fields.kept === 1, 'S2-3 edge.write 如实分开记「真落了 1 条」「已在位 1 条」（' + JSON.stringify(w && w.fields) + '）')
    const got = ((r.data && r.data.blockedBy) || []).map((b: any) => String(b.key)).sort().join(',')
    check(got === '2,3', 'S2-4 终态两条边都在（实得 ' + got + '）')
  }

  // ── S3 真值读到且与目标一致：一条都不写 ──
  {
    const state = makeState({ blocked: { '1': ['2'], '2': [] } })
    const { r, log } = await callSetBlockedBy(graph, state, ['2'])
    check(r.ok === true, 'S3-1 目标就是现状时照样回成功（实得 ok=' + r.ok + '）')
    check(state.posts.length === 0 && state.deletes.length === 0, 'S3-2 一条都没写（POST ' + state.posts.length + ' / DELETE ' + state.deletes.length + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.reason === 'noop' && w.fields.kept === 1 && w.fields.added === 0 && w.fields.removed === 0, 'S3-3 edge.write 记成 noop、kept 1（' + JSON.stringify(w && w.fields) + '）')
  }

  // ── S4 整批替换语义：多出来的那条撤掉，在位的那条不动 ──
  {
    const state = makeState({ blocked: { '1': ['2', '3'], '2': [], '3': [] } })
    const { r, log } = await callSetBlockedBy(graph, state, ['2'])
    check(r.ok === true, 'S4-1 收窄目标成功（实得 ok=' + r.ok + '）')
    check(state.deletes.join(',') === '3' && state.posts.length === 0, 'S4-2 只撤多出来的 3，没有补写（撤 ' + (state.deletes.join(',') || '(空)') + ' / 补 ' + state.posts.length + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.removed === 1 && w.fields.added === 0 && w.fields.kept === 1 && w.fields.reason === 'diff', 'S4-3 edge.write 记下撤 1 留 1（' + JSON.stringify(w && w.fields) + '）')
  }

  // ── S5 对账之后才发现那条边本来就不在（上游晚一拍）：目标已达成，不算失败 ──
  {
    const state = makeState({ blocked: { '1': ['2', '3'], '2': [], '3': [] }, deleteFails: ['3'] })
    const { r, log } = await callSetBlockedBy(graph, state, ['2'])
    check(r.ok === true, 'S5-1 撤一条本来就不在的边不算失败（实得 ok=' + r.ok + ' ' + String((r.error && r.error.message) || '') + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.ok === true && w.fields.removed === 0, 'S5-2 edge.write 如实记「撤下去 0 条」而不是编一条（' + JSON.stringify(w && w.fields) + '）')
  }

  // ── S6 原生真值问不到（端点不在、没权限）：退回契约字段老口径，行为与改动前一致 ──
  {
    const state = makeState({ blocked: { '1': ['2'], '2': [], '3': [] }, nativeGetFails: true })
    const { r, log } = await callSetBlockedBy(graph, state, ['2', '3'])
    check(state.nativeGets === 1, 'S6-1 确实问过一次原生真值（实问 ' + state.nativeGets + ' 次）')
    check(r.ok === true && state.posts.join(',') === '3', 'S6-2 老口径照样只提交真差集（实发 ' + (state.posts.join(',') || '(空)') + '，ok=' + r.ok + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.added === 1 && w.fields.kept === 1, 'S6-3 轨迹与真实结果一致（' + JSON.stringify(w && w.fields) + '）')
  }

  // ── S7 原生真值问不到 + 撤边回 404：仍判「这个仓库不支持依赖边」（老行为一字不改） ──
  {
    const state = makeState({ blocked: { '1': ['2'], '2': [], '3': [] }, contract: { '1': ['2', '3'] }, nativeGetFails: true })
    const { r, log } = await callSetBlockedBy(graph, state, ['2'])
    check(r.ok === false && String((r.error && r.error.kind) || '') === 'unsupported', 'S7-1 问不到真值时的 404 仍判 unsupported（实得 ' + String((r.error && r.error.kind) || r.ok) + '）')
    check(state.posts.length === 0, 'S7-2 判 unsupported 时没有半路补写（POST ' + state.posts.length + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.ok === false && w.fields.reason === 'fail:' + String(r.error.kind), 'S7-3 edge.write 的 reason 就是「fail:档位」（' + JSON.stringify(w && w.fields) + '）')
  }

  // ── S8 自环：一次外部调用都不发 ──
  {
    const state = makeState({ blocked: { '1': [], '2': [] } })
    const { r, log } = await callSetBlockedBy(graph, state, ['1'])
    check(r.ok === false && String((r.error && r.error.kind) || '') === 'conflict', 'S8-1 自环仍判 conflict（实得 ' + String((r.error && r.error.kind) || r.ok) + '）')
    check(state.posts.length === 0 && state.deletes.length === 0 && state.nativeGets === 0, 'S8-2 自环在写之前就被拒，没发任何外部调用（POST ' + state.posts.length + ' / 原生真值 ' + state.nativeGets + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.route === 'none' && w.fields.ok === false, 'S8-3 edge.write 记下「没走到外部调用」（' + JSON.stringify(w && w.fields) + '）')
  }

  // ── S9 成环：名册路径上的环检查照样拦（守 #895-⑥） ──
  {
    const state = makeState({ blocked: { '1': [], '2': ['1'] } })
    const { r, log } = await callSetBlockedBy(graph, state, ['2'])
    check(r.ok === false && String((r.error && r.error.kind) || '') === 'conflict', 'S9-1 反向边仍判 conflict（实得 ' + String((r.error && r.error.kind) || r.ok) + '）')
    check(state.posts.length === 0 && state.deletes.length === 0, 'S9-2 成环时不落任何边（POST ' + state.posts.length + ' / DELETE ' + state.deletes.length + '）')
    const cy = lastOf(log, 'edge.cycle')
    check(!!cy && cy.fields.verdict === 'cycle', 'S9-3 edge.cycle 记下 cycle（' + JSON.stringify(cy && cy.fields) + '）')
  }

  // ── S10 关掉调试开关：三条按需事件一行不发，常驻那条照发 ──
  {
    const state = makeState({ blocked: { '1': ['2'], '2': [] } })
    const { r, log } = await callSetBlockedBy(graph, state, ['2'], '1', false)
    check(r.ok === true, 'S10-1 关掉调试开关不影响写入本身（实得 ok=' + r.ok + '）')
    check(linesOf(log, 'edge.write').length === 1, 'S10-2 常驻的 edge.write 照发（实发 ' + linesOf(log, 'edge.write').length + ' 行）')
    check(linesOf(log, 'edge.cycle').length === 0 && linesOf(log, 'edge.roster').length === 0, 'S10-3 按需的 edge.cycle / edge.roster 一行不发（实发 ' + linesOf(log, 'edge.cycle').length + ' / ' + linesOf(log, 'edge.roster').length + '）')
  }

  // ── S11 REST 树边修复：认下几条子票边、失败的数得出来 ──
  {
    const repair = await imp('src/tracker/rooms/github/parent-repair.ts')
    const state = makeState({ subIssues: { '10': [100, 101] } })
    const log: any[] = []
    const ctx = makeCtx(makeStub(state), null, log, true)
    const raws: any[] = [
      { number: 10, labels: [{ name: 'wayfinder:map' }] },
      { number: 100, labels: [] },
      { number: 101, labels: [] },
      { number: 11, labels: [{ name: 'wayfinder:task' }] },
    ]
    await repair.repairParentLinksREST(raws, { owner: 'o', name: 'r' }, ctx)
    check(raws[1].parent && raws[1].parent.number === 10 && raws[2].parent && raws[2].parent.number === 10, 'S11-1 两张子票都挂回地图 10（实得 ' + JSON.stringify([raws[1].parent, raws[2].parent]) + '）')
    const e = lastOf(log, 'edge.repair')
    check(!!e && e.fields.maps === 1 && e.fields.linked === 2 && e.fields.failed === 0, 'S11-2 edge.repair 记下 1 张地图、认下 2 条边、0 失败（' + JSON.stringify(e && e.fields) + '）')
    check(keysOf(e && e.fields) === 'failed,latencyMs,linked,maps', 'S11-3 edge.repair 字段就是登记的那四个')

    const state2 = makeState({ subIssues: { '12': [120] }, subIssuesFails: ['12'] })
    const log2: any[] = []
    const ctx2 = makeCtx(makeStub(state2), null, log2, true)
    await repair.repairParentLinksREST([{ number: 12, labels: [{ name: 'wayfinder:map' }] }], { owner: 'o', name: 'r' }, ctx2)
    const e2 = lastOf(log2, 'edge.repair')
    check(!!e2 && e2.fields.maps === 1 && e2.fields.linked === 0 && e2.fields.failed === 1, 'S11-4 单张地图读失败照旧不抛错，失败数记进 failed（' + JSON.stringify(e2 && e2.fields) + '）')
  }

  // ── S12 GraphQL 主路：一次批量取 id + 每条边一次 mutation，REST 一次都不碰 ──
  {
    const state = makeState({ blocked: { '1': ['2'], '2': [], '3': [] }, gqlWorks: true })
    const { r, log } = await callSetBlockedBy(graph, state, ['2', '3'])
    check(r.ok === true, 'S12-1 GraphQL 主路补边成功（实得 ok=' + r.ok + ' ' + String((r.error && r.error.message) || '') + '）')
    check(state.gqlIds === 1, 'S12-2 只查一次 node id（批量别名，实查 ' + state.gqlIds + ' 次）')
    check(state.gqlMutations.join(',') === 'add:3', 'S12-3 只给真正缺的那条发 mutation（实发 ' + (state.gqlMutations.join(',') || '(空)') + '）')
    check(state.attempts.length === 0 && state.posts.length === 0 && state.deletes.length === 0, 'S12-4 回落那条 REST 路一次都没走（POST ' + state.posts.length + ' / DELETE ' + state.deletes.length + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.route === 'graphql' && w.fields.ok === true && w.fields.added === 1 && w.fields.kept === 1 && w.fields.reason === 'diff', 'S12-5 edge.write 记下 GraphQL 主路的轨迹（' + JSON.stringify(w && w.fields) + '）')
    check(linesOf(log, 'graphql.fallback').length === 0 && linesOf(log, 'fallback.chain').length === 0, 'S12-6 走通主路时不发降级线（' + linesOf(log, 'graphql.fallback').length + ' / ' + linesOf(log, 'fallback.chain').length + '）')
    const got = ((r.data && r.data.blockedBy) || []).map((b: any) => String(b.key)).sort().join(',')
    check(got === '2,3', 'S12-7 读回两条边都在（实得 ' + got + '）')
    check(state.unscripted.length === 0, 'S12-8 桩里没有未预料到的请求（' + state.unscripted.join(' | ').slice(0, 120) + '）')

    // 同一张票上接着撤一条：走的还是 GraphQL 主路，route 逐趟如实记。
    const rem = await callSetBlockedBy(graph, state, ['2'])
    check(rem.r.ok === true, 'S12-9 GraphQL 主路撤边成功（实得 ok=' + rem.r.ok + '）')
    check(state.gqlMutations.join(',') === 'add:3,remove:3', 'S12-10 撤边也只对真正多出来的那条发 mutation（实发 ' + state.gqlMutations.join(',') + '）')
    const w2 = lastOf(rem.log, 'edge.write')
    check(!!w2 && w2.fields.route === 'graphql' && w2.fields.removed === 1 && w2.fields.added === 0 && w2.fields.kept === 1, 'S12-11 撤边这一趟的轨迹也对（' + JSON.stringify(w2 && w2.fields) + '）')
    const got2 = ((rem.r.data && rem.r.data.blockedBy) || []).map((b: any) => String(b.key)).sort().join(',')
    check(got2 === '2', 'S12-12 撤完读回只剩 2（实得 ' + got2 + '）')
  }

  // ── S13 GraphQL 明确回「字段不存在」：只这一档回落 REST，并留下降级线 ──
  {
    const state = makeState({ blocked: { '1': ['2', '3'], '2': [], '3': [] } })
    const { r, log } = await callSetBlockedBy(graph, state, ['2'])
    check(r.ok === true, 'S13-1 回落 REST 后照常成功（实得 ok=' + r.ok + '）')
    check(state.gqlIds === 1 && state.gqlMutations.length === 0, 'S13-2 试过 GraphQL（id 查询 1 次）但没真写成任何一条 mutation（实发 ' + state.gqlMutations.length + ' 条）')
    check(state.deletes.join(',') === '3', 'S13-3 剩下的那条由 REST 撤销（实撤 ' + (state.deletes.join(',') || '(空)') + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.route === 'rest' && w.fields.removed === 1, 'S13-4 edge.write 如实记「最后还是走了 REST」（' + JSON.stringify(w && w.fields) + '）')
    const fb = lastOf(log, 'graphql.fallback')
    check(!!fb && fb.fields.scope === '单票' && ['timeout', 'rate-limit', 'ghe-host', 'graphql-error'].includes(fb.fields.reason), 'S13-5 graphql.fallback 记下 scope 与原因（' + JSON.stringify(fb && fb.fields) + '）')
    const ch = lastOf(log, 'fallback.chain')
    check(!!ch && ch.fields.in === 'graphql' && ch.fields.out === 'rest' && typeof ch.fields.latencyMs === 'number', 'S13-6 fallback.chain 记下从哪来、到哪去（' + JSON.stringify(ch && ch.fields) + '）')
    check(keysOf(fb && fb.fields) === 'reason,scope', 'S13-7 graphql.fallback 字段就是登记的那两个')
    check(keysOf(ch && ch.fields) === 'in,latencyMs,out', 'S13-8 fallback.chain 字段就是登记的那三个')
  }

  // ── S14 node id 查询失败：不硬写、回落 REST ──
  {
    const state = makeState({ blocked: { '1': [], '2': [] }, gqlIdsFail: true })
    const { r, log } = await callSetBlockedBy(graph, state, ['2'])
    check(r.ok === true, 'S14-1 id 查询失败不影响写边本身（走 REST 兜底，实得 ok=' + r.ok + '）')
    check(state.gqlIds === 1 && state.gqlMutations.length === 0, 'S14-2 只试了一次 id 查询、没发 mutation（' + state.gqlIds + ' / ' + state.gqlMutations.length + '）')
    check(state.posts.join(',') === '2', 'S14-3 由 REST 把边补上（实补 ' + (state.posts.join(',') || '(空)') + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.route === 'rest' && w.fields.added === 1, 'S14-4 edge.write 记成 REST 路（' + JSON.stringify(w && w.fields) + '）')
    check(linesOf(log, 'graphql.fallback').length === 1, 'S14-5 降级线发出一次（实发 ' + linesOf(log, 'graphql.fallback').length + ' 行）')
  }

  // ── S15 目标就是现状：连 node id 都不查（一条外部写边命令都不发） ──
  {
    const state = makeState({ blocked: { '1': ['2'], '2': [] } })
    const { r, log } = await callSetBlockedBy(graph, state, ['2'])
    check(r.ok === true, 'S15-1 noop 照常成功（实得 ok=' + r.ok + '）')
    check(state.gqlIds === 0 && state.gqlMutations.length === 0 && state.posts.length === 0 && state.deletes.length === 0, 'S15-2 一条外部写边调用都没发（id ' + state.gqlIds + ' / mutation ' + state.gqlMutations.length + ' / POST ' + state.posts.length + ' / DELETE ' + state.deletes.length + '）')
    const w = lastOf(log, 'edge.write')
    check(!!w && w.fields.reason === 'noop' && w.fields.route === 'rest', 'S15-3 edge.write 记成 noop（' + JSON.stringify(w && w.fields) + '）')
    check(linesOf(log, 'graphql.fallback').length === 0, 'S15-4 noop 不发降级线（' + linesOf(log, 'graphql.fallback').length + ' 行）')
  }

  console.log('\n共 ' + total + ' 条，' + (failed ? '有失败' : '全部通过'))
  if (failed) process.exitCode = 1
}

await main()
