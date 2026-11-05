/**
 * tests/verify-1898-pr-merged-refresh.ts —— 拉取请求合并状态的刷新路径（#1898，规格 #1885 S7）
 *
 * 守什么（票面四条验收逐条落在这里）：
 *   A 房间取数：只要拉取请求时只问拉取请求那一条查询，拿回来的已合并行是「已关闭 + 合并时间 + 评审」，
 *     状态筛下推的是 CLOSED 与 MERGED 两档（GitHub 的拉取请求有三态，「已合并」也归在 closed 里）。
 *   B 请求上限：补历史的那一趟每轮最多翻一页（CLOSED_PULL_REFRESH_MAX_PAGES）。假后端明明还有下一页，
 *     有上限时只发一页就停、并如实记成截断；没有上限时照旧翻到底（证明停下来的确实是那个上限）。
 *     GraphQL 主路与 REST 降级路都守：主路一页一条请求，降级两张表各一页。
 *   C 写进库：真 SQLite 临时库 + 假后端驱动整条路 —— 已合并的 PR 写进库之后，读库是「已关闭 + 合并时间」，
 *     评审组也在；关掉所有库句柄再读（等价于换会话 / 重开宿主）仍然是同一结论，不依赖任何内存副本。
 *   D 页签：库里那份行投影出来的行 stateKind 是 merged，页签切片里 merged 1 / open 0；
 *     真 React 渲染页签，画出来的是「已合并」，那一行不再挂「打开」。
 *   E 节拍：这条补取不跟着每一拍探测跑 —— 同一窗口内再调一次一条请求都不发；
 *     差一毫秒到窗口仍按节流回掉；满了窗口才再发一次。节拍取自 config/intervals.yaml 的
 *     closedPullRefreshIntervalMs（这里用生成出来的中央常量断言边界，不写第二份数字）。
 *   F 探针接线：探针这一拍探成了才去补（探测失败的那一拍不补）；没接这一格时探针照常工作。
 *
 * 为什么这么测：这四条验收说的都是「取数 → 写库 → 重开 → 页签」这条外部行为，所以用真库、真房间
 * 读函数、假 gh 客户端（只有进程那一头是假的），不去断言房间内部怎么拼查询；页签那一组用
 * react-dom/server 静态渲染，读的是页面真正画出来的字。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1898-pr-merged-refresh.ts
 */
// 门禁归属: src/refresh/rooms/host/issue-list-fetch.ts
// 门禁归属: src/refresh/rooms/host/probe-handler.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-adapter.ts
// 门禁归属: src/tracker/rooms/github/read/issues.ts
// 门禁归属: src/tracker/rooms/github/read/issues-rest-list.ts
// 门禁归属: src/tracker/rooms/github/read/pulls.ts
// 门禁归属: src/tracker/rooms/github/read/read-page-cap.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { listIssues } from '../src/tracker/rooms/github/read/issues.ts'
import { createIssueList } from '../src/refresh/rooms/host/issue-list-fetch.ts'
import { createProbeHandler } from '../src/refresh/rooms/host/probe-handler.ts'
import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.ts'
import {
  closeSnapshotLibraries,
  readIssueDetail,
  readSnapshotReplay,
  recordIssueRows,
} from '../src/refresh/rooms/host/snapshot-library.ts'
import { CLOSED_PULL_REFRESH_MAX_PAGES } from '../src/refresh/kernel/host-budget.ts'
// 说明符照仓里其它门禁的写法写 .js：钩子会把它落到 src/ 下的同名 .ts（域源码的形状）。
import { CLOSED_PULL_REFRESH_INTERVAL_MS, PROBE_INTERVAL_MS } from '../src/shared/time-config/values.js'
import { deckPrListOf } from '../src/client/kernel/deck-pr-list.ts'
import { prStateKind } from '../src/client/views/shared/stateKind.ts'

const GATE = 'verify-1898-pr-merged-refresh'
let total = 0
let failed = 0
function check(ok: unknown, message: string, detail?: unknown): void {
  total += 1
  if (ok) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

const REPO: any = { backend: 'github', refId: 'acme/widgets', name: 'acme/widgets', url: 'https://github.com/acme/widgets' }
const MERGED_AT = '2026-11-02T00:00:00Z'

/** 一条 gh 调用的记录：渠道（graphql / rest）、它属于哪张表、原始参数。 */
interface RecordedCall { channel: string; kind: string; args: string[] }

/** GraphQL 的拉取请求节点（#42 是合并了的那张，带一条评审）。 */
function pullNodeOf(n: number, mergedAt: string | null, reviews: any[]): any {
  return {
    number: n,
    title: n === 42 ? '久等的合并请求' : ('PR ' + n),
    state: mergedAt ? 'MERGED' : 'CLOSED',
    body: 'PR ' + n + ' 的正文',
    url: 'https://github.com/acme/widgets/pull/' + n,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
    closedAt: '2026-11-02T00:00:00Z',
    mergedAt: mergedAt,
    author: { login: 'alice' },
    assignees: { nodes: [] },
    labels: { nodes: [{ name: 'ready-for-agent', color: '3fb950' }] },
    milestone: null,
    comments: { totalCount: 0, nodes: [] },
    reviews: { nodes: reviews },
  }
}

function approvedReview(): any {
  return { state: 'APPROVED', author: { login: 'bob' }, submittedAt: '2026-11-01T00:00:00Z' }
}

/** GitHub 的 REST 行（/issues 与 /pulls 两种形状；PR 行在 /issues 里只带 pull_request 标记）。 */
function restRowOf(node: any, withPullMarker: boolean): any {
  const row: any = {
    number: node.number,
    title: node.title,
    state: 'closed',
    body: node.body,
    html_url: node.url,
    created_at: node.createdAt,
    updated_at: node.updatedAt,
    closed_at: node.closedAt,
    merged_at: node.mergedAt,
    user: { login: 'alice' },
    labels: [],
  }
  if (withPullMarker) row.pull_request = { merged_at: null }
  return row
}

/**
 * 假 gh 客户端：只认两种查询 —— GraphQL 的 issues / pullRequests 连接，以及 REST 的 /issues 与 /pulls 列表。
 * pullPages 是拉取请求连接「后端还有几页」；页面都是满的，于是「再翻一页也拿得到」这件事是真的，
 * 页上限停不停得住才测得出东西。graphqlFails 用来把主路打坏、逼出 REST 降级路。
 */
function makeFakeGh(options: { pullPages: number; graphqlFails?: boolean }): any {
  const calls: RecordedCall[] = []
  const pullPages = Math.max(1, options.pullPages)
  function pageOfAfter(args: string[]): number {
    for (const a of args) {
      if (typeof a === 'string' && a.indexOf('after=') === 0) {
        const m = /^p(\d+)$/.exec(a.slice(6))
        return m ? Number(m[1]) : 1
      }
    }
    return 1
  }
  function pageOfRest(pathArg: string): number {
    const m = /[?&]page=(\d+)/.exec(pathArg)
    return m ? Number(m[1]) : 1
  }
  function gqlNodesOfPage(page: number): any[] {
    const rows: any[] = []
    for (let i = 0; i < 50; i++) {
      const n = (page === 1 && i === 0) ? 42 : (page * 1000 + i)
      rows.push(pullNodeOf(n, n === 42 ? MERGED_AT : null, n === 42 ? [approvedReview()] : []))
    }
    return rows
  }
  function restNodesOfPage(page: number): any[] {
    const rows: any[] = []
    // REST 一页给满 100 行：不设页上限时它本来会继续翻下一页，这才看得出上限有没有拦住。
    for (let i = 0; i < 100; i++) {
      const n = (page === 1 && i === 0) ? 42 : (page * 1000 + i)
      rows.push(pullNodeOf(n, n === 42 ? MERGED_AT : null, []))
    }
    return rows
  }
  async function exec(_cmd: string, args: string[]): Promise<any> {
    const list: string[] = Array.isArray(args) ? args : []
    const isGraphql = list[1] === 'graphql'
    const query = isGraphql ? String(list[3] || '') : ''
    const pathArg = isGraphql ? '' : String(list[1] || '')
    const kind = isGraphql
      ? (query.indexOf('pullRequests') >= 0 ? 'gql.pulls' : 'gql.issues')
      : (pathArg.indexOf('/pulls?') >= 0 ? 'rest.pulls' : 'rest.issues')
    calls.push({ channel: isGraphql ? 'graphql' : 'rest', kind: kind, args: list })
    if (isGraphql && options.graphqlFails) return { code: 1, stdout: '', stderr: 'Post "https://api.github.com/graphql": boom' }
    if (isGraphql && kind === 'gql.issues') {
      return { code: 0, stdout: JSON.stringify({ data: { repository: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }), stderr: '' }
    }
    if (isGraphql) {
      const page = pageOfAfter(list)
      return {
        code: 0,
        stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: gqlNodesOfPage(page), pageInfo: { hasNextPage: page < pullPages, endCursor: 'p' + String(page + 1) } } } } }),
        stderr: '',
      }
    }
    const page = pageOfRest(pathArg)
    const rows = restNodesOfPage(page).map(function (n: any): any {
      if (kind === 'rest.pulls') return restRowOf(n, false)
      // /issues 回的是工单与拉取请求混排：PR 只带标记，合并时间由 /pulls 那一趟富化（与生产同一条路）。
      return restRowOf(n, true)
    })
    return { code: 0, stdout: JSON.stringify(rows), stderr: '' }
  }
  return { calls: calls, exec: exec }
}

/** 房间需要的调用上下文：出站控制面、平台解析、执行器（假的）、日志口（静默）。 */
function roomContextOf(fake: any): any {
  return {
    outbound: createOutboundControl(),
    cwd: process.cwd(),
    platform: { resolveExecutable: async function (n: string): Promise<string | null> { return n === 'gh' ? 'gh' : null }, env: { get: function (): string { return '' } } },
    exec: fake.exec,
    logEvent: function (): void {},
    isEnabled: function (): boolean { return false },
  }
}

function kindsOf(fake: any): string[] {
  return fake.calls.map(function (c: RecordedCall): string { return c.kind })
}

/** 假事件库：探针那一条路必填的失败历史口，这里只记有没有被调。 */
function noop(): void {}

/** 我们喂给库的「合并之前」那一行（拉取请求，还开着）。 */
function openPullSeed(): any {
  return {
    key: '42',
    effortId: '',
    type: 'issue',
    title: '还没合并的时候',
    state: 'open',
    body: '',
    url: 'https://github.com/acme/widgets/pull/42',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    mergedAt: null,
    isPullRequest: true,
    labels: [],
    assignees: [{ login: 'alice' }],
    fieldStates: {
      mergeInfo: { known: true, value: null },
      review: { known: false, reason: 'not-expressed' },
    },
  }
}

async function main(): Promise<void> {
  // ============================================================
  // A. 房间取数：已合并的拉取请求是「已关闭 + 合并时间 + 评审」
  // ============================================================
  {
    const fake = makeFakeGh({ pullPages: 1 })
    const result: any = await listIssues(REPO, { state: 'closed', isPullRequest: true }, roomContextOf(fake))
    const rows: any[] = Array.isArray(result && result.data) ? result.data : []
    const merged = rows.filter(function (r: any): boolean { return String(r.key) === '42' })[0] || null
    check(result && result.ok === true && rows.length === 50 && !!merged, 'A1 已合并的拉取请求被取回来（只要拉取请求那一档，一页 50 条里就有它）', { ok: result && result.ok, rows: rows.length })
    check(!!merged && merged.state === 'closed', 'A2 取回来的行是「已关闭」（已合并归到关闭，与契约两态同一口径）', merged && merged.state)
    check(!!merged && merged.mergedAt === MERGED_AT, 'A3 行的合并时间就是后端给的那一刻', merged && merged.mergedAt)
    check(!!merged && merged.isPullRequest === true, 'A4 行上带着「这是拉取请求」的标记（界面的拉取请求页签按它收行）', merged && merged.isPullRequest)
    check(!!merged && Array.isArray(merged.reviews) && merged.reviews.length === 1 && String(merged.reviews[0].state).toLowerCase() === 'approved',
      'A5 行的评审明细跟着回来（一行 APPROVED）', merged && merged.reviews)
    const prCalls = fake.calls.filter(function (c: RecordedCall): boolean { return c.kind === 'gql.pulls' })
    const statesArg = prCalls.length ? prCalls[0].args.filter(function (a: string): boolean { return a.indexOf('states[]=') === 0 }) : []
    check(statesArg.indexOf('states[]=CLOSED') >= 0 && statesArg.indexOf('states[]=MERGED') >= 0,
      'A6 状态筛下推的是 CLOSED 与 MERGED 两档（只写 CLOSED 会让已合并整批消失）', statesArg)
    check(kindsOf(fake).indexOf('gql.issues') < 0, 'A7 只要拉取请求时工单那条查询整段跳过（不白花一条请求与一页窗口）', kindsOf(fake))
  }

  // ============================================================
  // B. 请求上限：一轮最多翻一页，多的一页也不翻
  // ============================================================
  {
    const capped = makeFakeGh({ pullPages: 5 })
    const cappedResult: any = await listIssues(REPO, { state: 'closed', isPullRequest: true }, Object.assign({ listMaxPages: CLOSED_PULL_REFRESH_MAX_PAGES }, roomContextOf(capped)))
    const cappedPrCalls = capped.calls.filter(function (c: RecordedCall): boolean { return c.kind === 'gql.pulls' })
    check(cappedPrCalls.length === CLOSED_PULL_REFRESH_MAX_PAGES && cappedPrCalls.length === 1,
      'B1 页上限 = ' + CLOSED_PULL_REFRESH_MAX_PAGES + ' 时，后端还有 5 页也只在第 1 页停手（一条请求）', cappedPrCalls.length)
    check(cappedResult && cappedResult.ok === true && cappedResult.data.length === 50,
      'B2 停下来的那一页行照常交回来（50 条，不丢页首那一条）', cappedResult && cappedResult.data && cappedResult.data.length)
    check(cappedResult && cappedResult.truncated === true,
      'B3 停页如实记成截断（没有把「只翻了一页」说成取全了）', cappedResult && cappedResult.truncated)

    const uncapped = makeFakeGh({ pullPages: 3 })
    const uncappedResult: any = await listIssues(REPO, { state: 'closed', isPullRequest: true }, roomContextOf(uncapped))
    const uncappedPrCalls = uncapped.calls.filter(function (c: RecordedCall): boolean { return c.kind === 'gql.pulls' })
    check(uncappedPrCalls.length === 3 && uncappedResult && uncappedResult.data.length === 150,
      'B4 没给页上限时照旧翻到底（3 页 150 条）—— 证明上面停下来的确实是那个上限', { calls: uncappedPrCalls.length, rows: uncappedResult && uncappedResult.data && uncappedResult.data.length })
    check(uncappedResult && !uncappedResult.truncated, 'B5 翻到底的那一趟不记截断', uncappedResult && uncappedResult.truncated)

    const singlePage = makeFakeGh({ pullPages: 1 })
    const singleResult: any = await listIssues(REPO, { state: 'closed', isPullRequest: true }, Object.assign({ listMaxPages: CLOSED_PULL_REFRESH_MAX_PAGES }, roomContextOf(singlePage)))
    check(singleResult && singleResult.ok === true && singleResult.truncated === false,
      'B6 页上限恰好等于后端页数时不算截断（后端说没有下一页就是到底了，不误报「没取全」）', singleResult && singleResult.truncated)

    const degraded = makeFakeGh({ pullPages: 3, graphqlFails: true })
    const restResult: any = await listIssues(REPO, { state: 'closed', isPullRequest: true }, Object.assign({ listMaxPages: CLOSED_PULL_REFRESH_MAX_PAGES }, roomContextOf(degraded)))
    const restIssues = degraded.calls.filter(function (c: RecordedCall): boolean { return c.kind === 'rest.issues' })
    const restPulls = degraded.calls.filter(function (c: RecordedCall): boolean { return c.kind === 'rest.pulls' })
    check(restIssues.length === 1 && restPulls.length === 1,
      'B7 降级一路也受页上限约束：工单表一页 + 拉取请求表一页，第 2 页一条都不发', { issues: restIssues.length, pulls: restPulls.length })
    const restMerged = (restResult && Array.isArray(restResult.data) ? restResult.data : []).filter(function (r: any): boolean { return String(r.key) === '42' })[0] || null
    check(restResult && restResult.ok === true && restResult.fallback === 'rest' && !!restMerged && restMerged.mergedAt === MERGED_AT,
      'B8 降级回的那一页里，已合并的拉取请求照样带着合并时间（REST 列表从 /pulls 富化）', restMerged && restMerged.mergedAt)
  }

  // ============================================================
  // C. 补进库：行、合并时间、评审；关库重开仍是同一结论
  // ============================================================
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1898-'))
  const KEY = { workspaceRoot: tempRoot, backend: 'github', repoIdentity: 'acme/widgets' }
  let clock = 1_762_000_000_000
  try {
    mkdirSync(path.join(tempRoot, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1898' + String.fromCharCode(10), 'utf8')
    const seeded: any = await recordIssueRows(Object.assign({ rows: [openPullSeed()] }, KEY))
    check(seeded && seeded.ok === true, 'C0 先往库里写一行「还没合并」的拉取请求（后面要看它翻成已合并）', seeded)

    const fake = makeFakeGh({ pullPages: 5 })
    const list: any = createIssueList({
      getRepoKey: async function (): Promise<any> { return { owner: 'acme', name: 'widgets' } },
      issueIndexFromSnapshot: function (): any { return {} },
      issueIndexChanged: function (): boolean { return false },
      rememberIssueIndex: noop,
      openSession: async function (): Promise<any> {
        return {
          ok: true,
          backendId: 'github',
          repoRef: REPO,
          call: function (fn: any): any {
            const session: any = {
              list: function (ref: any, filter: any, opCtx: any): any {
                return listIssues(ref, filter, Object.assign({}, roomContextOf(fake), opCtx || {}))
              },
            }
            return fn(session, { cwd: tempRoot })
          },
        }
      },
      onIssueRows: function (cwd: any, ref: any, rows: any[]): any {
        return recordIssueRows({ workspaceRoot: cwd, backend: String(ref.backend || ''), repoIdentity: String(ref.refId || ''), rows: rows })
      },
      getSnapshotLibrary: async function (): Promise<any> { return null },
      logCtx: null,
      noteSnapshot: noop,
      now: function (): number { return clock },
    })

    const first: any = await list.refreshClosedPulls(tempRoot)
    check(first && first.ok === true && first.ran === true && first.fetched === 50 && first.written === 50,
      'C1 补取跑了一趟：取回一页 50 条、整页写进库', first)
    check(fake.calls.filter(function (c: RecordedCall): boolean { return c.kind === 'gql.pulls' }).length === 1,
      'C2 这一趟真的只发了一条拉取请求查询（页上限在整条路上都生效）', kindsOf(fake))

    const replay: any = await readSnapshotReplay(Object.assign({ repo: REPO }, KEY))
    const row = replay && Array.isArray(replay.snapshot.issues)
      ? replay.snapshot.issues.filter(function (x: any): boolean { return String(x.key) === '42' })[0]
      : null
    check(!!row && row.state === 'closed', 'C3 库里读到的那一行是「已关闭」', row && row.state)
    check(!!row && row.mergedAt === new Date(Date.parse(MERGED_AT)).toISOString(), 'C4 库里有合并时间（页签判「已合并」靠的就是它）', row && row.mergedAt)
    check(!!row && row.isPullRequest === true, 'C5 库里那一行仍然标明是拉取请求', row && row.isPullRequest)

    const detail: any = await readIssueDetail(Object.assign({ key: '42', effortId: '' }, KEY))
    const detailIssue: any = detail && detail.issue ? detail.issue : null
    check(!!detailIssue && !!detailIssue.groups.mergeInfo && detailIssue.groups.mergeInfo.completeness === 'complete' && detailIssue.mergedAtMs === Date.parse(MERGED_AT),
      'C6 合并信息组是「完整」且值是后端那一刻（不是靠界面补的）', detailIssue && detailIssue.groups && detailIssue.groups.mergeInfo && detailIssue.mergedAtMs)
    check(!!detailIssue && !!detailIssue.groups.review && detailIssue.groups.review.completeness === 'complete' && detailIssue.reviews.length === 1,
      'C7 评审组也完整地写进了库（一条评审）', detailIssue && detailIssue.groups && detailIssue.groups.review && detailIssue.reviews && detailIssue.reviews.length)

    // 关掉所有库句柄再读：等价于换会话 / 重开宿主，内存里那份东西一件都不许参与。
    closeSnapshotLibraries()
    const reopened: any = await readSnapshotReplay(Object.assign({ repo: REPO }, KEY))
    const rowAgain = reopened && Array.isArray(reopened.snapshot.issues)
      ? reopened.snapshot.issues.filter(function (x: any): boolean { return String(x.key) === '42' })[0]
      : null
    check(!!rowAgain && rowAgain.state === 'closed' && rowAgain.mergedAt === new Date(Date.parse(MERGED_AT)).toISOString(),
      'C8 关库重开之后仍然是「已关闭 + 合并时间」（不依赖进程内存）', { state: rowAgain && rowAgain.state, mergedAt: rowAgain && rowAgain.mergedAt })
    const detailAgain: any = await readIssueDetail(Object.assign({ key: '42', effortId: '' }, KEY))
    const againIssue: any = detailAgain && detailAgain.issue ? detailAgain.issue : null
    check(!!againIssue && againIssue.groups.review && againIssue.groups.review.completeness === 'complete' && againIssue.reviews.length === 1,
      'C9 关库重开之后评审也还在', againIssue && againIssue.reviews && againIssue.reviews.length)

    // ============================================================
    // D. 页签：从库里投影出来的那一行就是「已合并」
    // ============================================================
    const slice: any = deckPrListOf({ projection: reopened.snapshot, version: reopened.mergeVersion, rows: reopened.snapshot.issues, stateKindOf: prStateKind })
    const mergedRow = slice.rows.filter(function (r: any): boolean { return String(r.key) === '42' })[0] || null
    check(!!mergedRow && mergedRow.stateKind === 'merged', 'D1 页签切片里那一行的状态种类是 merged', mergedRow && mergedRow.stateKind)
    check(slice.total === 50 && slice.merged === 1 && slice.open === 0,
      'D2 切片四个数：50 条拉取请求里 1 条已合并、0 条打开', { total: slice.total, merged: slice.merged, open: slice.open })

    // ---- 真渲染：页面画出来的是「已合并」，那一行不再挂「打开」
    const React: any = (await import('react')).default
    const { renderToStaticMarkup } = await import('react-dom/server')
    const labels: Record<string, string> = { 'list.state.merged': '已合并', 'list.state.open': '打开', 'list.state.closed': '已关闭', 'pr.empty': '没有拉取请求' }
    ;(globalThis as any).localStorage = { getItem: function (): any { return null }, setItem: noop, removeItem: noop }
    ;(globalThis as any).tr = function (key: any): string { return labels[String(key)] || String(key) }
    ;(globalThis as any).log = noop
    ;(globalThis as any).idOfParts = function (a: any, b: any): string { return String(a) + '\u0000' + String(b) }
    ;(globalThis as any).React = React
    ;(globalThis as any).Ic = function (props: any): any { return '[' + ((props && props.n) || '?') + ']' }
    ;(globalThis as any).prFilterForList = function (): any { return { isPullRequest: true } }
    ;(globalThis as any).buildColorOf = function (): any { return {} }
    ;(globalThis as any).hexA = function (): any { return null }
    ;(globalThis as any).darken = function (): any { return null }
    ;(globalThis as any).CONTAINER_ACCENT = { map: '#bc8cff' }
    ;(globalThis as any).MOTION = { inlineSpinnerMs: 700 }
    // 渲染这一组只喂「合并了的那一条」：页签的 key 警告是 PrTab 既有的数组字面量形状（不在本票范围），
    // 喂 50 行会把同一类警告刷 150 行，盖住门禁自己的断言输出；D2 那组已经用整份切片验过四个数。
    const renderSlice: any = deckPrListOf({ projection: reopened.snapshot, version: reopened.mergeVersion, rows: [mergedRow], stateKindOf: prStateKind })
    ;(globalThis as any).useDeckViewSlice = function (_st: any, name: string): any { return name === 'prList' ? renderSlice : null }
    ;(globalThis as any).deckViewCommand = function (): void {}
    ;(globalThis as any).prStateKind = prStateKind
    ;(globalThis as any).prIssuesOf = function (): any[] { return [] }
    const { DswsCtx, createCx } = await import('../src/client/kernel/ctx.ts')
    ;(globalThis as any).DswsCtx = DswsCtx
    const services: any = {
      slots: { register: function (): any { return function (): void {} }, inject: function (_n: string, fn: any): void { try { fn() } catch (e) {} } },
      locale: { register: function (): any { return function (): void {} }, bind: function (): any { return (globalThis as any).tr } },
      timer: { timeout: function (fn: any, ms: any): any { return setTimeout(fn, ms) } },
    }
    const fakeStore: any = { snapshot: null, sessionId: 'test', tab: 'pr', cwd: tempRoot, issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false } }
    const fakeCx: any = createCx({
      ctx: { get: function (k: any): any { return services[k] }, effect: function (fn: any): any { const r = fn(); return typeof r === 'function' ? r : function (): void {} }, inject: function (_d: any, cb: any): any { cb({ get: function (k: any): any { return services[k] } }); return { dispose: function (): void {} } } },
      h: React.createElement,
      rdom: {},
      storeSvc: { shared: fakeStore, stores: {}, makeStore: function (): any { return fakeStore }, storeOf: function (): any { return fakeStore }, emit: function (): void {}, sub: function (): any { return function (): void {} }, useStore: function (): any { return fakeStore } },
      localeSvc: { register: function (): any { return function (): void {} }, bind: function (): any { return (globalThis as any).tr } },
      timer: services.timer,
      api: { call: async function (): Promise<any> { return { ok: true } }, inject: function (): void {}, copyText: async function (): Promise<void> {} },
      router: { open: function (): void {}, toggle: function (): void {} },
    } as any)
    const { PrTab } = await import('../src/client/views/PrTab.ts')
    const html: string = renderToStaticMarkup(React.createElement(DswsCtx.Provider as any, { value: fakeCx }, React.createElement(PrTab as any, { st: { snapshot: null, selection: null, backendModules: [], snapMode: 'real' } })))
    check(html.indexOf('久等的合并请求') >= 0, 'D3 页签把那条拉取请求画出来了（数据来自库投影，不是页面自己挑行）', html.slice(0, 120))
    check((html.match(/已合并/g) || []).length === 1, 'D4 页签上写着「已合并」（只有那一行一条）', (html.match(/已合并/g) || []).length)
    check(html.indexOf('>打开<') < 0, 'D5 那一行不再挂「打开」', html.indexOf('>打开<'))
    check(html.indexOf('data-state="merged"') >= 0, 'D6 那一行的 data-state 也是 merged（浅色层按它换色）', html.slice(0, 200))

    // ============================================================
    // E. 节拍：不跟着每一拍探测跑
    // ============================================================
    const callsBefore = fake.calls.filter(function (c: RecordedCall): boolean { return c.kind === 'gql.pulls' }).length
    clock += 0
    const again: any = await list.refreshClosedPulls(tempRoot)
    check(again && again.ran === false && again.reason === 'throttled', 'E1 同一时刻再调一次：按节流回掉，不算跑过', again)
    check(fake.calls.filter(function (c: RecordedCall): boolean { return c.kind === 'gql.pulls' }).length === callsBefore,
      'E2 节流的那一次一条请求都没发', fake.calls.filter(function (c: RecordedCall): boolean { return c.kind === 'gql.pulls' }).length)
    clock += CLOSED_PULL_REFRESH_INTERVAL_MS - 1
    const justBefore: any = await list.refreshClosedPulls(tempRoot)
    check(justBefore && justBefore.ran === false && justBefore.reason === 'throttled', 'E3 差一毫秒到窗口：仍然节流（边界按中央常量算）', justBefore)
    clock += 1
    const due: any = await list.refreshClosedPulls(tempRoot)
    check(due && due.ok === true && due.ran === true, 'E4 满窗口之后才真的再跑一次', due)
    check(fake.calls.filter(function (c: RecordedCall): boolean { return c.kind === 'gql.pulls' }).length === callsBefore + 1,
      'E5 满窗口那一次只多发一条拉取请求查询', fake.calls.filter(function (c: RecordedCall): boolean { return c.kind === 'gql.pulls' }).length)
    check(CLOSED_PULL_REFRESH_INTERVAL_MS >= PROBE_INTERVAL_MS,
      'E6 这条补取的节拍不短于探测的节拍（不跟着每一拍探测跑）', { refresh: CLOSED_PULL_REFRESH_INTERVAL_MS, probe: PROBE_INTERVAL_MS })
  } finally {
    try { closeSnapshotLibraries() } catch (e) {}
    try { rmSync(tempRoot, { recursive: true, force: true }) } catch (e) {}
  }

  // ============================================================
  // F. 探针接线：探成了才补，没接这一格也照常干活
  // ============================================================
  {
    const refreshed: string[] = []
    function probeDeps(overrides?: Record<string, unknown>): any {
      return Object.assign({
        canonicalKey: async function (c: any): Promise<any> { return c },
        selectEarly: async function (): Promise<any> { return {} },
        isComposerSelection: function (): boolean { return false },
        getTrackerRegistry: async function (): Promise<any> { return {} },
        getPlatform: async function (): Promise<any> { return {} },
        ctx: {},
        detectionExec: noop,
        fetchIssueIndexWindowed: async function (): Promise<any> {
          return { ok: true, changed: false, repo: { owner: 'acme', name: 'widgets' }, count: 1, nextWatermarkMs: 1, repoIdentity: 'acme/widgets', backendId: 'github' }
        },
        issueIndexChanged: function (): boolean { return false },
        rememberIssueIndex: noop,
        commitIssueIndex: async function (): Promise<any> { return { ok: true } },
        degradedStandingOf: function (): boolean { return false },
        lastIssueIndexByRepo: {},
        lastProbeAtByRepo: {},
        deltaRefresh: async function (): Promise<any> { return null },
        takeWritePatch: async function (): Promise<any> { return null },
        errText: function (e: any): string { return String((e && e.message) || e) },
        openSession: async function (): Promise<any> { return { ok: false, reason: 'none' } },
        logCtx: null,
        noteRefreshFailure: noop,
        refreshClosedPulls: function (cwd: any): any { refreshed.push(cwd); return Promise.resolve({ ok: true }) },
      }, overrides || {})
    }
    const wired: any = createProbeHandler(probeDeps())
    const probeResult: any = await wired.handleProbe({ cwd: tempRoot })
    check(probeResult && probeResult.ok === true && refreshed.length === 1 && refreshed[0] === tempRoot,
      'F1 探针这一拍探成之后就调了一次补取（参数是当前工作区）', { ok: probeResult && probeResult.ok, refreshed: refreshed })

    refreshed.length = 0
    const failing: any = createProbeHandler(probeDeps({ fetchIssueIndexWindowed: async function (): Promise<any> { return { ok: false, error: { kind: 'network', message: 'boom' } } } }))
    const failedProbe: any = await failing.handleProbe({ cwd: tempRoot })
    check(failedProbe && failedProbe.ok === false && refreshed.length === 0,
      'F2 探测失败的那一拍不补（网络或额度正不正常时不再多花一条请求）', { ok: failedProbe && failedProbe.ok, refreshed: refreshed })

    const bare: any = createProbeHandler(probeDeps({ refreshClosedPulls: undefined }))
    const bareResult: any = await bare.handleProbe({ cwd: tempRoot })
    check(bareResult && bareResult.ok === true, 'F3 没接这一格时探针照常工作（老装配不受影响）', bareResult && bareResult.ok)
  }

  // ============================================================
  // G. 别的后端：没有「拉取请求」这一种行，别白跑一条请求
  // ============================================================
  {
    let listCalls = 0
    const other: any = createIssueList({
      getRepoKey: async function (): Promise<any> { return { owner: 'acme', name: 'widgets' } },
      issueIndexFromSnapshot: function (): any { return {} },
      issueIndexChanged: function (): boolean { return false },
      rememberIssueIndex: noop,
      openSession: async function (): Promise<any> {
        return {
          ok: true,
          backendId: 'gitlab',
          repoRef: { backend: 'gitlab', refId: 'acme/widgets', name: 'acme/widgets', url: 'https://gitlab.com/acme/widgets' },
          call: function (fn: any): any {
            return fn({ list: async function (): Promise<any> { listCalls += 1; return { ok: true, data: [] } } }, { cwd: tempRoot })
          },
        }
      },
      onIssueRows: async function (): Promise<any> { return { ok: true } },
      getSnapshotLibrary: async function (): Promise<any> { return null },
      logCtx: null,
      noteSnapshot: noop,
      now: function (): number { return clock },
    })
    const otherResult: any = await other.refreshClosedPulls(tempRoot)
    check(otherResult && otherResult.ran === false && otherResult.reason === 'not-applicable' && listCalls === 0,
      'G1 别的后端不跑这条补取（没有拉取请求这一种行，一条请求都不白花）', { result: otherResult, listCalls: listCalls })
  }
}

main().then(function (): void {
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}, function (err: any): void {
  console.error('门禁脚本自身出错：', err)
  printGateResult(GATE, total, failed + 1)
  process.exit(1)
})
