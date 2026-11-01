/**
 * tests/tracker-contract/sections/list-state.ts — 「列表状态筛下推」契约段（#1796）。
 *
 * 背景：右侧面板的工单列表一次只翻到 500 条就停，而 GitHub 按更新时间倒序返回。
 *   改造前查询把「打开」与「已关闭」写死在同一批里，高编号的已关闭票会把低编号的未关闭票
 *   挤出窗口，面板上看起来就是「这些票不见了」。修法是把调用方要的状态档下推到查询：
 *   GraphQL 用 $states 变量、REST 降级路径用 state=open/closed/all（同时按更新时间倒序）。
 *
 * 这一段只对着真实 GitHub 后端模块断言，假身是一个脚本化的 gh：每次调用都把实参拼起来记下，
 *   断言落在「实际发给 gh 的 -F states[]=… 与 REST 请求地址」上，而不是只读查询正文 ——
 *   状态到底有没有下推，只有看实参才作数。
 *
 * 覆盖四件事：
 *   一、list({state:'open'})：工单与拉取请求都只带 OPEN；
 *   二、list({state:'closed'})：工单只带 CLOSED，拉取请求带 CLOSED 与 MERGED（已合并的不能消失，#599）；
 *   三、list({})：工单两态齐全、拉取请求三态齐全（与改造前一致）；
 *   四、GraphQL 失败改走 REST：工单与拉取请求的请求地址都带 state=open、sort=updated、direction=desc。
 */

import { createRegistry } from '../../../src/tracker/registry/core.js'
import { githubModule } from '../../../src/tracker/rooms/github/room/index.js'
import { createOutboundControl } from '../../../src/refresh/rooms/host/outbound-control.js'
import type { BackendContext, OpContext } from '../../../src/tracker/contract/contexts.js'
import type { RepositoryRef } from '../../../src/tracker/contract/entities.js'

/** 单条断言的结果：ok 为判定，detail 留现场。 */
interface ListStateAssertResult {
  name: string
  ok: boolean
  detail: string
}

const ISSUES_OK = { data: { repository: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }
const PULLS_OK = { data: { repository: { pullRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }

/**
 * 脚本化 gh：正常时按查询类型回空页；graphqlFail 为 true 时把 GraphQL 打挂，让 list 走 REST 降级。
 * 空页对分页是「到底了」的证据，所以两条路都不会再翻第二页，断言只看到第一页的地址。
 */
function scriptedCtx(calls: string[], opts?: { graphqlFail?: boolean }): OpContext {
  const exec = async (_cmd: string, args?: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    const joined = (args || []).join(' ')
    calls.push(joined)
    if (joined.includes('graphql')) {
      if (opts && opts.graphqlFail) return { code: 1, stdout: '', stderr: 'Post "https://api.github.com/graphql": unexpected EOF' }
      const payload = joined.includes('pullRequests(') ? PULLS_OK : ISSUES_OK
      return { code: 0, stdout: JSON.stringify(payload), stderr: '' }
    }
    // REST 降级：/issues 与 /pulls 都回空页；其它端点（sub_issues 等）也一律回空数组，本段不判它们。
    return { code: 0, stdout: '[]', stderr: '' }
  }
  return {
    cwd: '/ws/fake',
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async (n: string) => (n === 'gh' ? 'gh' : null) },
    exec,
    isEnabled: () => false,
    logEvent: () => {},
  } as unknown as OpContext
}

export async function run(): Promise<ListStateAssertResult[]> {
  const out: ListStateAssertResult[] = []
  const P = 'list-state · '
  const assert = (name: string, cond: unknown, detail?: string): void => {
    out.push({ name: P + name, ok: !!cond, detail: detail || '' })
  }

  const regCtx = { logEvent: () => {}, isEnabled: () => false } as unknown as BackendContext
  const reg = createRegistry(regCtx, { matchesTimeout: 200 })
  const d = reg.register(githubModule)
  const gh = reg.get('github')!
  const ref: RepositoryRef = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }

  // ── 一、state:'open' —— 两类票都只查 OPEN，查询正文用变量而不是写死字面量 ──
  {
    const calls: string[] = []
    await gh.list(ref, { state: 'open' }, scriptedCtx(calls))
    const issueGql = calls.filter((c) => c.includes('issues(first:')).join('\n')
    const prGql = calls.filter((c) => c.includes('pullRequests(')).join('\n')
    assert('state:open 时工单查询只带 states[]=OPEN', /states\[\]=OPEN/.test(issueGql), issueGql.slice(0, 200))
    assert('state:open 时工单查询不带 states[]=CLOSED', !/states\[\]=CLOSED/.test(issueGql), issueGql.slice(0, 200))
    assert('state:open 时拉取请求查询只带 states[]=OPEN', /states\[\]=OPEN/.test(prGql) && !/states\[\]=(CLOSED|MERGED)/.test(prGql), prGql.slice(0, 200))
    assert('状态走查询变量（正文写 states:$states，不写死状态字面量）', /states:\$states/.test(issueGql) && !/states:\[(OPEN|CLOSED|MERGED)/.test(issueGql), issueGql.slice(0, 200))
  }

  // ── 二、state:'closed' —— 工单只要 CLOSED；拉取请求要 CLOSED + MERGED（已合并的归到已关闭）──
  {
    const calls: string[] = []
    await gh.list(ref, { state: 'closed' }, scriptedCtx(calls))
    const issueGql = calls.filter((c) => c.includes('issues(first:')).join('\n')
    const prGql = calls.filter((c) => c.includes('pullRequests(')).join('\n')
    assert('state:closed 时工单查询只带 states[]=CLOSED', /states\[\]=CLOSED/.test(issueGql) && !/states\[\]=OPEN/.test(issueGql), issueGql.slice(0, 200))
    assert('state:closed 时拉取请求查询带 states[]=CLOSED 与 states[]=MERGED（已合并的不能消失）', /states\[\]=CLOSED/.test(prGql) && /states\[\]=MERGED/.test(prGql), prGql.slice(0, 220))
  }

  // ── 三、不给 state —— 与改造前一致：工单两态、拉取请求三态 ──
  {
    const calls: string[] = []
    await gh.list(ref, {}, scriptedCtx(calls))
    const issueGql = calls.filter((c) => c.includes('issues(first:')).join('\n')
    const prGql = calls.filter((c) => c.includes('pullRequests(')).join('\n')
    assert('不给 state 时工单查询两态齐全（OPEN + CLOSED）', /states\[\]=OPEN/.test(issueGql) && /states\[\]=CLOSED/.test(issueGql), issueGql.slice(0, 200))
    assert('不给 state 时拉取请求查询三态齐全（OPEN + CLOSED + MERGED）', /states\[\]=OPEN/.test(prGql) && /states\[\]=CLOSED/.test(prGql) && /states\[\]=MERGED/.test(prGql), prGql.slice(0, 220))
  }

  // ── 四、GraphQL 打挂走 REST —— 状态档与排序也要落到请求地址上 ──
  {
    const calls: string[] = []
    const r = await gh.list(ref, { state: 'open' }, scriptedCtx(calls, { graphqlFail: true }))
    const issueRest = calls.filter((c) => c.includes('/issues?')).join('\n')
    const pullRest = calls.filter((c) => c.includes('/pulls?')).join('\n')
    assert('GraphQL 失败后确实走了 REST 降级（回执 ok 为真）', !!(r && r.ok), JSON.stringify(r).slice(0, 200))
    assert('REST 工单请求带 state=open', /\/issues\?state=open(&|$|\b)/.test(issueRest), issueRest.slice(0, 240))
    assert('REST 工单请求按更新时间倒序（sort=updated + direction=desc）', /sort=updated/.test(issueRest) && /direction=desc/.test(issueRest), issueRest.slice(0, 240))
    assert('REST 拉取请求请求带 state=open 且按更新时间倒序', /\/pulls\?state=open/.test(pullRest) && /sort=updated/.test(pullRest) && /direction=desc/.test(pullRest), pullRest.slice(0, 240))
  }

  d.dispose()
  return out
}

export default { name: 'listState', run }
