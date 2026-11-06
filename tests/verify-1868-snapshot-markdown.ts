/**
 * tests/verify-1868-snapshot-markdown.ts —— 本地 Markdown 支路接进同一套快照库（#1868）
 *
 * 守什么（票面四条验收逐条对应）：
 *   A/B：本地 Markdown 的列表批次经 composer 支路按组写进本地快照库；断网重启后首屏从库铺出
 *        容器树、子票、标签与认领人，联网口（列表、分页、会话、执行命令、当前用户、旧磁盘快照）
 *        一个都不许动。
 *   C：详情与关系落库；「这次没表达」与「这个后端没有」两件事分得开——本地 Markdown 有子票
 *      （只是这次读结果没带计数，所以那一组根本没写过），而评审与合并信息它根本没有，写成
 *      unknown + not-applicable。
 *   D：重启后详情从库出、不再取数；票号补零（本地 Markdown 用 01）的键在读写两侧都对得上。
 *   E：状态、可见状态与状态来源三个字段按现有语义落库、读回来一字不差。
 *   F：客户端没有第二份持久快照。
 *
 * 为什么用真 SQLite 与真宿主装配：写库与回放要穿过真正的快照树（按组合并、边表、三态），替身
 * 盖不住这些。会话用一个按本地 Markdown 契约形状回话的假对象，只把「会不会联网」变成可数的事实。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1868-snapshot-markdown.ts
 */
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-adapter.ts

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { createSessionSnapshot } from '../src/refresh/rooms/host/session-snapshot-cache.ts'
import { createCommentThreads } from '../src/refresh/rooms/host/comment-thread-fetch.ts'
import * as snapshotLibrary from '../src/refresh/rooms/host/snapshot-library.ts'

const GATE = 'verify-1868-snapshot-markdown'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 本地 Markdown 的工作单元标识就是目录名（票面「工作单元标识按现有规则取自目录名」）。 */
const EFFORT = 'alpha'

let total = 0
let failed = 0

function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) {
    console.log('PASS ' + message)
    return
  }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

/** 本地 Markdown 契约形状：没有 fieldStates；票号补零；地址由读写文件那一层给出。 */
function mdIssue(input: Partial<Issue> & { key: string; title: string }): Issue {
  const base: Issue = {
    key: input.key,
    effortId: EFFORT,
    type: input.type || 'issue',
    title: input.title,
    state: input.state || 'open',
    body: input.body || '',
    url: '',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: input.updatedAt || '2026-11-01T00:00:00Z',
    closedAt: input.closedAt || null,
    parentKey: input.parentKey === undefined ? null : input.parentKey,
    labels: input.labels || [],
    assignees: input.assignees || [],
    blockedBy: input.blockedBy || [],
  }
  return Object.assign(base, input)
}

/** 本地 Markdown 的票面状态字段（#1204 那套：状态、可见状态、状态来源）。 */
function mdDetail(): Issue {
  return mdIssue({
    key: '01',
    title: '第一张子票',
    body: '这是本地 Markdown 票的正文。',
    // 详情比列表晚取到：更新时间必须更晚，#1931 起读结果的行组只在「严格更新」时才覆盖
    // （否则 C 组那趟更晚的列表重写会把这边的状态字段挡住）。
    updatedAt: '2026-11-06T00:00:00Z',
    parentKey: '00',
    status: 'doing',
    statusVisible: 'doing',
    statusSource: 'visible',
    labels: [{ name: 'ready-for-agent', color: 'ededed' }],
    assignees: [{ login: 'alice', name: '爱丽丝' }],
    blockedBy: [{ key: '05', title: '独立票', state: 'open' }],
    comments: [{ id: 'c1', author: { login: 'bob' }, authorAssociation: 'MEMBER', body: '第一条评论', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }],
    commentCount: 1,
  })
}

function upcaseSnapStates(snap: any): any {
  const up = (row: any) => { if (row && row.state) row.state = String(row.state).toUpperCase(); return row }
  ;(snap.maps || []).forEach((m: any) => { up(m); (m.tickets || []).forEach(up) })
  ;(snap.issues || []).forEach(up)
  return snap
}

function groupTicketsOf(tickets: any[]): any {
  return {
    total: tickets.length,
    open: tickets.filter((t) => t.state !== 'CLOSED').length,
    closed: tickets.filter((t) => t.state === 'CLOSED').length,
    frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {},
  }
}

interface Counters {
  openSession: number
  sessionCall: number
  list: number
  listPage: number
  get: number
  currentUser: number
  exec: number
  diskRead: number
  diskWrite: number
}

function newCounters(): Counters {
  return { openSession: 0, sessionCall: 0, list: 0, listPage: 0, get: 0, currentUser: 0, exec: 0, diskRead: 0, diskWrite: 0 }
}

/** 一个按本地 Markdown 契约回话的假会话：列表、分页、子票、详情四件事。 */
function mdSession(rows: Issue[], detail: Issue, counters: Counters, failList = false): any {
  return {
    list: async (_ref: any, filter: any) => {
      counters.list += 1
      if (failList) return { ok: false, error: { kind: 'network', message: '断网了' } }
      let out = rows
      if (filter && filter.state === 'open') out = rows.filter((r) => r.state !== 'closed')
      return { ok: true, data: out.map((r) => Object.assign({}, r)) }
    },
    listPage: async () => {
      counters.listPage += 1
      return { ok: true, data: { items: [], nextCursor: null, total: 0 } }
    },
    listSubIssues: async (_ref: any, parent: any) => ({
      ok: true,
      data: rows.filter((r) => r.parentKey != null && String(r.parentKey) === String(parent && (parent.key || parent.number)) && String(r.key) !== String(parent && (parent.key || parent.number))),
    }),
    counts: async () => ({ ok: true, data: { open: rows.filter((r) => r.state !== 'closed').length, closed: rows.filter((r) => r.state === 'closed').length, total: rows.length } }),
    get: async () => { counters.get += 1; return { ok: true, data: detail } },
  }
}

/**
 * 造一个本地 Markdown 工作区的快照电话。
 *
 * `openSession` 是仓库身份的真源：本地 Markdown 的身份就是工作区目录本身（refId 等于 cwd），
 * 这正是这个后端的正确身份。真正的后端调用都在 `call` 里，由计数器记着——「断网」时一个都不许涨。
 */
function mdPhone(options: { root: string; rows: Issue[]; detail: Issue; cache: Map<string, any>; failList?: boolean }) {
  const adopted: { snap: any } = { snap: null }
  const counters = newCounters()
  const repoRef: RepositoryRef = { backend: 'markdown', refId: options.root, name: 'ws', url: '', effortId: EFFORT }
  const session = mdSession(options.rows, options.detail, counters, options.failList === true)
  const openSession = async () => {
    counters.openSession += 1
    return {
      ok: true,
      backendId: 'markdown',
      repoRef,
      canWrite: false,
      call: async (fn: (s: any, c: any) => unknown) => { counters.sessionCall += 1; return fn(session, {}) },
    }
  }
  const registry = {
    // describe 只给目录：refId 就是工作区目录本身（本地 Markdown 没有 owner/name 可解析）。
    describe: () => ({ backend: 'markdown', refId: options.root, name: 'ws', url: '', effortId: EFFORT }),
    modules: () => [],
    get: () => ({ getCurrentUser: async () => { counters.currentUser += 1; return { ok: false, error: { kind: 'unsupported' } } } }),
  }
  const phone = createSessionSnapshot({
    canonicalKey: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'markdown', rev: 1 }),
    isComposerSelection: () => true,
    getTrackerRegistry: async () => registry,
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    getCache: (c: string) => options.cache.get(String(c)) || { ts: 0, snapshot: null },
    setCache: (v: any) => { options.cache.set(String(v.cwd), { ts: v.ts, snapshot: v.snapshot }) },
    CACHE_MS: 60000,
    cacheSnapshotIsCurrent: async () => { counters.cacheIsCurrent += 1; return false },
    upcaseSnapStates,
    computeLevels: () => ({ byNumber: {}, byKey: {} }),
    groupTickets: groupTicketsOf,
    getRepoRoot: async () => options.root,
    getRepoKey: async () => null,
    readDiskCache: async () => { counters.diskRead += 1; return null },
    writeDiskCache: () => { counters.diskWrite += 1 },
    adoptSnapshot: (snap: unknown) => { adopted.snap = snap; return snap },
    detectionExec: () => { counters.exec += 1; throw new Error('断网时不该发命令') },
    getGhPath: () => null,
    getGhLastError: () => null,
    errText: (e: any) => String((e && e.message) || e),
    getSnapshotLibrary: async () => snapshotLibrary,
    openSession,
    logCtx: null,
  } as any)
  return { phone, adopted, counters, repoRef }
}

/** 详情与评论电话：`get` 的调用次数记在 counters 上，断网时不许涨。 */
function mdThreads(options: { root: string; rows: Issue[]; detail: Issue }) {
  const counters = newCounters()
  const repoRef: RepositoryRef = { backend: 'markdown', refId: options.root, name: 'ws', url: '', effortId: EFFORT }
  const session = mdSession(options.rows, options.detail, counters)
  const openSession = async (_cwd: unknown, opts?: any) => ({
    ok: true,
    backendId: 'markdown',
    repoRef,
    canWrite: !!(opts && opts.write),
    call: async (fn: (s: any, c: any) => unknown) => { counters.sessionCall += 1; return fn(session, {}) },
  })
  const threads = createCommentThreads({
    normCwd: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'markdown', rev: 1 }),
    isComposerSelection: () => true,
    getTrackerRegistry: async () => ({ describe: () => repoRef, modules: () => [] }),
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    timer: null,
    DEFAULT_CWD: '',
    errText: (e: any) => String((e && e.message) || e),
    isRateLimitError: () => false,
    getRepoKey: async () => null,
    execProc: async () => ({ ok: true, text: '', code: 0 }),
    fetchIssueDetail: async () => ({ ok: false }),
    fetchIssueIndex: async () => ({ ok: false }),
    issueIndexFromSnapshot: () => ({}),
    setCache: () => {},
    getCache: () => ({ ts: 0, snapshot: null }),
    writeDiskCache: async () => {},
    openSession,
    getSnapshotLibrary: async () => snapshotLibrary,
    logCtx: null,
  } as any)
  return { threads, counters, repoRef }
}

function findContainer(snap: any, key: string): any {
  return ((snap && snap.maps) || []).filter((m: any) => String(m.key) === key)[0]
}

function findTicket(container: any, key: string): any {
  return ((container && container.tickets) || []).filter((t: any) => String(t.key) === key)[0]
}

function findIssue(snap: any, key: string): any {
  return ((snap && snap.issues) || []).filter((x: any) => String(x.key) === key)[0]
}

/** 本地 Markdown 的列表读结果：两张容器（地图 00、规格 10）加三张散票，票号全部补零。 */
function listRows(updatedAt?: string): Issue[] {
  const rows = [
    mdIssue({ key: '00', type: 'map', title: '探索地图：本地 Markdown 首屏', labels: [{ name: 'wayfinder:map', color: '5319e7' }] }),
    mdIssue({ key: '01', title: '第一张子票', parentKey: '00', labels: [{ name: 'ready-for-agent', color: 'ededed' }], assignees: [{ login: 'alice', name: '爱丽丝' }], blockedBy: [{ key: '05', title: '独立票', state: 'open' }] }),
    mdIssue({ key: '10', type: 'spec', title: '规格：本地 Markdown 支路' }),
    mdIssue({ key: '11', title: '规格子票', parentKey: '10' }),
    mdIssue({ key: '05', title: '独立票', labels: [{ name: 'bug', color: 'd73a4a' }] }),
  ]
  // updatedAt 可给：C 组要用「更晚的更新时间 + 更早的取数时刻」把列表组压旧。
  // #1931 起读结果的行组按「更新时间严格更新才覆盖」判，同一时刻的重写会被跳过，
  // 取数时刻也就不会推新，「列表组已旧」这个现场就造不出来。
  return updatedAt ? rows.map((row) => Object.assign({}, row, { updatedAt })) : rows
}

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1868-markdown-'))
  try {
    mkdirSync(path.join(tempRoot, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1868\n', 'utf8')

    // ── A. 第一次首屏：composer 支路取回本地 Markdown 列表，按批写进库 ─────────────
    const cacheA = new Map<string, any>()
    const hostA = mdPhone({ root: tempRoot, rows: listRows(), detail: mdDetail(), cache: cacheA })
    const first: any = await hostA.phone.handleSnapshot({ cwd: tempRoot, effortId: EFFORT, backendId: 'markdown' })
    check(first && first.ok === true, 'A1 本地 Markdown 首屏在线组装成功', first)
    check(hostA.counters.list >= 1, 'A2 第一次真的走了一趟列表取数（composer 支路）', hostA.counters)
    const replayA = await snapshotLibrary.readSnapshotReplay({ workspaceRoot: tempRoot, backend: 'markdown', repoIdentity: tempRoot, repo: hostA.repoRef })
    check(replayA !== null && replayA.rows === 5, 'A3 本地 Markdown 列表批次写进了库（五张票）', replayA && replayA.rows)
    check(replayA !== null && !!findContainer(replayA.snapshot, '00') && !!findContainer(replayA.snapshot, '10'), 'A4 地图与规格两个容器都在库里', replayA && Object.keys(replayA.snapshot || {}))
    check(replayA !== null && !!findTicket(findContainer(replayA.snapshot, '00'), '01'), 'A5 子票按父子边挂在容器下', replayA && findContainer(replayA.snapshot, '00'))
    check(hostA.counters.diskWrite === 0, 'A6 首屏不再写旧磁盘快照', hostA.counters)
    check(hostA.adopted.snap && hostA.adopted.snap.ok === true && hostA.adopted.snap.fromCache !== true, 'A7 第一次是新鲜数据，不是回放', hostA.adopted.snap && hostA.adopted.snap.fromCache)

    // 票面「工作单元标识按现有规则取自目录名」：库里这张票的 effortId 就是目录名。
    const detailAfterA = await snapshotLibrary.readIssueDetail({ workspaceRoot: tempRoot, backend: 'markdown', repoIdentity: tempRoot, key: '01', effortId: EFFORT })
    check(!!detailAfterA && detailAfterA.issue !== null && detailAfterA.issue!.effortId === EFFORT, 'A8 工作单元标识取自目录名', detailAfterA && detailAfterA.issue && detailAfterA.issue.effortId)

    // ── B. 断网重启：首屏只从库出，联网口全部计数 ─────────────────────────────────
    snapshotLibrary.closeSnapshotLibraries()
    const cacheB = new Map<string, any>()
    const hostB = mdPhone({ root: tempRoot, rows: listRows(), detail: mdDetail(), cache: cacheB, failList: true })
    const second: any = await hostB.phone.handleSnapshot({ cwd: tempRoot, effortId: EFFORT, backendId: 'markdown' })
    check(second && second.ok === true, 'B1 断网重启后首屏成功', second)
    const snapB: any = hostB.adopted.snap || (second && second.snapshot)
    check(snapB && snapB.fromCache === true, 'B2 回包标了 fromCache（没走在线重建）', snapB && snapB.fromCache)
    check(snapB && snapB.diskReplay && snapB.diskReplay.schema === 'snapshot-sqlite-v1' && snapB.diskReplay.source === 'sqlite', 'B3 回包带 diskReplay 注记', snapB && snapB.diskReplay)
    check(!!(snapB && typeof snapB.diskReplay.lastKnownAtMs === 'number' && snapB.diskReplay.lastKnownAtMs > 0), 'B4 回包带上次已知时刻')
    check(!!findContainer(snapB, '00') && !!findContainer(snapB, '10'), 'B5 地图与规格容器树从库铺出')
    const ticket01 = findTicket(findContainer(snapB, '00'), '01')
    check(!!ticket01 && ticket01.labels && ticket01.labels[0].name === 'ready-for-agent', 'B6 标签随首屏从库出', ticket01 && ticket01.labels)
    check(!!ticket01 && ticket01.claimedBy === 'alice', 'B7 认领人随首屏从库出', ticket01 && ticket01.claimedBy)
    // 快照里的胶囊按数字挂（本地 Markdown 的票号补零，'05' 读回来是 5）：断言的是「指向同一张票」，不是字符串写法。
  check(!!ticket01 && Array.isArray(ticket01.blockedBy) && Number(ticket01.blockedBy[0]) === 5, 'B8 阻塞胶囊保留目标票号', ticket01 && ticket01.blockedBy)
    check(!!findIssue(snapB, '05'), 'B9 独立票从库铺出')
    check(hostB.counters.list === 0 && hostB.counters.listPage === 0 && hostB.counters.sessionCall === 0, 'B10 没有列表取数、没有分页、没有会话调用', hostB.counters)
    check(hostB.counters.exec === 0 && hostB.counters.currentUser === 0, 'B11 没有执行命令、没有问当前用户', hostB.counters)
    check(hostB.counters.diskRead === 0 && hostB.counters.diskWrite === 0, 'B12 没有读写旧磁盘快照', hostB.counters)

    // ── C. 详情：把列表的组时刻压旧，再打开详情，宿主必须取一次并写库 ───────────────
    snapshotLibrary.closeSnapshotLibraries()
    const realNow = Date.now
    try {
      Date.now = () => realNow() - 10 * 60 * 1000
      await snapshotLibrary.recordIssueRows({ workspaceRoot: tempRoot, backend: 'markdown', repoIdentity: tempRoot, rows: listRows('2026-11-05T00:00:00Z') })
    } finally {
      Date.now = realNow
    }
    const detailC = mdThreads({ root: tempRoot, rows: listRows(), detail: mdDetail() })
    const gotC: any = await detailC.threads.handleIssueDetail({ number: 1, effortId: EFFORT, cwd: tempRoot })
    check(gotC && gotC.ok === true, 'C1 本地 Markdown 详情读成功', gotC)
    check(detailC.counters.get === 1, 'C2 列表组已旧：详情真的取了一次', detailC.counters)
    check(gotC && gotC.issue && gotC.issue.body === '这是本地 Markdown 票的正文。', 'C3 交回的详情带正文', gotC && gotC.issue && gotC.issue.body)

    const storedC = await snapshotLibrary.readIssueDetail({ workspaceRoot: tempRoot, backend: 'markdown', repoIdentity: tempRoot, key: '01', effortId: EFFORT })
    const issueC: any = storedC && storedC.issue
    check(!!issueC && issueC.body === '这是本地 Markdown 票的正文。', 'C4 详情正文按组落库', issueC && issueC.body)
    check(!!issueC && issueC.groups.comments && issueC.groups.comments.completeness === 'complete', 'C5 评论组是完整的（1/1 条都取到了）', issueC && issueC.groups.comments)
    check(!!issueC && issueC.parents[0] && issueC.parents[0].key === '00', 'C6 父子关系从同一张边表写入', issueC && issueC.parents)
    check(!!issueC && issueC.blockedBy[0] && issueC.blockedBy[0].key === '05', 'C7 阻塞关系从同一张边表写入', issueC && issueC.blockedBy)

    // 票面 d/1868：状态三字段按现有语义落库。
    check(!!issueC && issueC.row.status === 'doing', 'C8 状态字段落库', issueC && issueC.row.status)
    check(!!issueC && issueC.row.statusVisible === 'doing', 'C9 可见状态字段落库', issueC && issueC.row.statusVisible)
    check(!!issueC && issueC.row.statusSource === 'visible', 'C10 状态来源字段落库', issueC && issueC.row.statusSource)

    // 「这次没表达」与「这个后端没有」必须分开：子票计数是前者（本地 Markdown 有子票），评审与合并信息是后者。
    const subGroupC = issueC && issueC.groups.subIssues
    const reviewGroupC = issueC && issueC.groups.review
    const mergeGroupC = issueC && issueC.groups.mergeInfo
    check(subGroupC === null, 'C11 子票计数这一组从没写过（这次读结果没表达，不是「不适用」）', subGroupC)
    check(!!reviewGroupC && reviewGroupC.completeness === 'unknown' && reviewGroupC.reason === 'not-applicable', 'C12 本地 Markdown 没有评审：写 unknown/not-applicable', reviewGroupC)
    check(!!mergeGroupC && mergeGroupC.completeness === 'unknown' && mergeGroupC.reason === 'not-applicable', 'C13 本地 Markdown 没有合并信息：写 unknown/not-applicable', mergeGroupC)
    check(!!issueC && issueC.subIssues === null && issueC.mergedAtMs === null, 'C14 库里没有把能力差异写成「确认没有」', issueC && { subIssues: issueC.subIssues, mergedAtMs: issueC.mergedAtMs })

    // ── D. 重启后详情与关系从库出，不再发取数 ─────────────────────────────────────
    snapshotLibrary.closeSnapshotLibraries()
    const detailD = mdThreads({ root: tempRoot, rows: listRows(), detail: mdDetail() })
    const gotD: any = await detailD.threads.handleIssueDetail({ number: 1, effortId: EFFORT, cwd: tempRoot })
    check(gotD && gotD.ok === true && gotD.fromSnapshot === true, 'D1 重启后详情从库出', gotD && gotD.fromSnapshot)
    check(detailD.counters.get === 0 && detailD.counters.sessionCall === 0, 'D2 重启后没有重取详情', detailD.counters)
    check(gotD && gotD.issue && gotD.issue.body === '这是本地 Markdown 票的正文。', 'D3 重启后正文还在', gotD && gotD.issue && gotD.issue.body)
    check(gotD && gotD.issue && gotD.issue.comments && gotD.issue.comments.nodes.length === 1, 'D4 重启后评论从库出', gotD && gotD.issue && gotD.issue.comments)
    check(gotD && gotD.issue && gotD.issue.blockedBy && gotD.issue.blockedBy.nodes[0].number === 5, 'D5 重启后阻塞关系从库出（补零的票号解得成数字）', gotD && gotD.issue && gotD.issue.blockedBy)
    const groupsD: any = (gotD && gotD.issue && (gotD.issue as any).snapshotGroups) || {}
    // 父票是谁从容器树读（详情回包只带这一组的三态，与线上同形）：这里断言那一组说得出「完整」。
    check(!!groupsD.parents && groupsD.parents.completeness === 'complete', 'D6 重启后父子这一组的三态从库出（父票本身从容器树读）', groupsD.parents)
    check(groupsD.review && groupsD.review.reason === 'not-applicable', 'D7 回包把「不适用」原样带给界面', groupsD.review)

    // ── E. 客户端没有第二份持久快照（三个后端共用同一份实现）───────────────────────
    const clientDir = path.join(ROOT, 'src', 'refresh', 'rooms', 'client')
    const storeFile = path.join(clientDir, 'snapshot-cache-store.ts')
    const storeText = readFileSync(storeFile, 'utf8')
    check(storeText.indexOf('indexedDB') < 0, 'E1 共享的客户端快照存储不再碰 IndexedDB')
    check(storeText.indexOf('diskPutSnapshot') < 0 && storeText.indexOf('diskGetSnapshot') < 0 && storeText.indexOf('SNAP_DISK_CAP') < 0, 'E2 客户端持久快照的三个口已删除（#1870：不再是留白的空操作）')
    const clientFiles = readdirSync(clientDir, { recursive: true })
      .map((rel) => path.join(clientDir, String(rel)))
      .filter((file) => file.endsWith('.ts'))
    const withIdb = clientFiles.filter((file) => readFileSync(file, 'utf8').indexOf('indexedDB') >= 0)
    check(withIdb.length === 0, 'E3 客户端目录里没有第二份 IndexedDB 持久快照', withIdb)
  } finally {
    snapshotLibrary.closeSnapshotLibraries()
    rmSync(tempRoot, { recursive: true, force: true })
  }
  printGateResult(GATE, total, failed)
}

main().catch((e) => {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exitCode = 1
})
