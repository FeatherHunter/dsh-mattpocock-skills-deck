/**
 * tests/verify-1867-snapshot-gitlab.ts —— GitLab 支路接进同一套快照库（#1867）
 *
 * 守什么（票面五条验收逐条对应）：
 *   A/B：GitLab 列表批次（composer 支路）按组写进本地快照库；把联网口全部计数之后重启，
 *        首屏仍然从库铺出容器树、子票与标签，回包带 fromCache 与 diskReplay 注记。
 *   C/D：GitLab 详情与关系从库出；断网重启后不再发取数；「能力差异」在库里写成
 *        unknown + reason=not-applicable，不是 complete + 空值。
 *   E：GitLab 没有的评审/合并信息/子票计数三组不冒充「确认没有」；GitLab 有的父子、
 *        阻塞、标签、指派、评论照常是完整的。
 *   F：宿主取数路给 GitLab 拼的是 GitLab 身份与地址，不是 GitHub 地址。
 *   G：客户端没有第二份持久快照——共享实现 `snapshot-cache-store.ts` 已不再读写 IndexedDB。
 *
 * 为什么用真 SQLite 与真宿主装配：写库与回放要穿过真正的快照树（按组合并、边表、三态），
 * 替身盖不住这些；会话用一个按 GitLab 契约形状回话的假对象，只把「会不会联网」变成可数的事实。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1867-snapshot-gitlab.ts
 */
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-first-screen.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-adapter.ts
// 门禁归属: src/refresh/rooms/host/issue-list-fetch.ts

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { createSessionSnapshot } from '../src/refresh/rooms/host/session-snapshot-cache.ts'
import { createCommentThreads } from '../src/refresh/rooms/host/comment-thread-fetch.ts'
import { createIssueList } from '../src/refresh/rooms/host/issue-list-fetch.ts'
import * as snapshotLibrary from '../src/refresh/rooms/host/snapshot-library.ts'

const GATE = 'verify-1867-snapshot-gitlab'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GITLAB_REPO: RepositoryRef = {
  backend: 'gitlab',
  refId: 'acme/project',
  name: 'project',
  url: 'https://gitlab.com/acme/project',
}
const GITHUB_REPO: RepositoryRef = {
  backend: 'github',
  refId: 'acme/widgets',
  name: 'widgets',
  url: 'https://github.com/acme/widgets',
}
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

/** GitLab 契约形状（与 src/tracker/rooms/gitlab/model/normalize.ts 的 normalizeIssue 同形）：没有 fieldStates。 */
function gitlabIssue(input: Partial<Issue> & { key: string; title: string; urlHost?: string }): Issue {
  const base: Issue = {
    key: input.key,
    effortId: '',
    type: input.type || 'issue',
    title: input.title,
    state: input.state || 'open',
    body: input.body || '',
    url: 'https://gitlab.com/acme/project/-/issues/' + input.key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: input.updatedAt || '2026-11-01T00:00:00Z',
    closedAt: input.closedAt || null,
    parentKey: input.parentKey === undefined ? null : input.parentKey,
    labels: input.labels || [],
    assignees: input.assignees || [],
    comments: [],
    blockedBy: input.blockedBy || [],
  }
  return Object.assign(base, input)
}

/** GitHub 契约形状：同样的行，唯一差别是三态与后端自己的地址。 */
function githubIssue(input: Partial<Issue> & { key: string; title: string }): Issue {
  const base: Issue = {
    key: input.key,
    effortId: '',
    type: input.type || 'issue',
    title: input.title,
    state: input.state || 'open',
    body: input.body || '',
    url: 'https://github.com/acme/widgets/issues/' + input.key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: input.updatedAt || '2026-11-01T00:00:00Z',
    closedAt: input.closedAt || null,
    parentKey: input.parentKey === undefined ? null : input.parentKey,
    labels: input.labels || [],
    assignees: input.assignees || [],
  }
  return Object.assign(base, input)
}

/** GitLab 的详情读结果：正文、标签、指派、父票、阻塞、一条评论；没有评审/合并/子票计数。 */
function gitlabDetail(): Issue {
  return gitlabIssue({
    key: '5',
    title: '子票五',
    body: '这是 GitLab 票的正文。',
    parentKey: '100',
    labels: [{ name: 'ready-for-agent', color: 'ededed' }],
    assignees: [{ login: 'alice' }],
    blockedBy: [{ key: '50', title: '已关闭的子票', state: 'closed' }],
    comments: [{ id: '1', author: { login: 'bob' }, authorAssociation: 'MEMBER', body: '第一条评论', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }],
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
  comment: number
  currentUser: number
  exec: number
  cacheIsCurrent: number
  diskRead: number
  diskWrite: number
}

function newCounters(): Counters {
  return { openSession: 0, sessionCall: 0, list: 0, listPage: 0, get: 0, comment: 0, currentUser: 0, exec: 0, cacheIsCurrent: 0, diskRead: 0, diskWrite: 0 }
}

/** 一个按 GitLab 契约回话的假会话：只做列表、分页、详情与评论四件事。 */
function gitlabSession(rows: Issue[], detail: Issue, counters: Counters, failList = false): any {
  return {
    list: async (ref: any, filter: any) => {
      counters.list += 1
      if (failList) return { ok: false, error: { kind: 'network', message: '断网了' } }
      let out = rows
      if (filter && filter.state === 'open') out = rows.filter((r) => r.state !== 'closed')
      if (filter && Array.isArray(filter.labels) && filter.labels.length) out = out.filter((r) => (r.labels || []).some((l) => filter.labels.indexOf(l.name) >= 0))
      return { ok: true, data: out.map((r) => Object.assign({}, r)) }
    },
    listPage: async (ref: any, filter: any) => {
      counters.listPage += 1
      return { ok: true, data: { items: [], nextCursor: null, total: 0 } }
    },
    listSubIssues: async () => ({ ok: false, error: { kind: 'unsupported', message: 'GitLab 不按这个口径给子票' } }),
    counts: async () => ({ ok: true, data: { open: rows.filter((r) => r.state !== 'closed').length, closed: rows.filter((r) => r.state === 'closed').length, total: rows.length } }),
    get: async () => { counters.get += 1; return { ok: true, data: detail } },
    comment: async () => {
      counters.comment += 1
      return { ok: true, data: { body: '新评论', author: { login: 'me' }, authorAssociation: 'OWNER', createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z' } }
    },
  }
}

/**
 * 造一个 GitLab 工作区的快照电话。
 *
 * `openSession` 是仓库身份的真源：它只回答 backendId 与 repoRef，不发任何请求；
 * 真正的后端调用都在 `call` 里，由计数器记着——「断网」时这些计数一个都不许涨。
 */
function gitlabPhone(options: {
  root: string
  rows: Issue[]
  detail: Issue
  counters: Counters
  cache: Map<string, any>
  failList?: boolean
}) {
  const adopted: { snap: any } = { snap: null }
  const counters = options.counters
  const session = gitlabSession(options.rows, options.detail, counters, options.failList === true)
  const openSession = async () => {
    counters.openSession += 1
    return {
      ok: true,
      backendId: 'gitlab',
      repoRef: GITLAB_REPO,
      canWrite: false,
      call: async (fn: (s: any, c: any) => unknown) => { counters.sessionCall += 1; return fn(session, {}) },
    }
  }
  const registry = {
    describe: () => ({ backend: 'gitlab', refId: '', name: 'project', url: '' }),
    modules: () => [],
    get: () => ({ getCurrentUser: async () => { counters.currentUser += 1; return { ok: true, data: { login: 'me' } } } }),
  }
  const phone = createSessionSnapshot({
    canonicalKey: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'gitlab', rev: 1 }),
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
  })
  return { phone, adopted }
}

/** 一个按 GitLab 会话回话的详情/评论电话装配；`get` 与 `comment` 的调用次数都记在 counters 上。 */
function gitlabThreads(options: { rows: Issue[]; detail: Issue; counters: Counters }) {
  const counters = options.counters
  const session = gitlabSession(options.rows, options.detail, counters)
  const openSession = async (_cwd: unknown, opts?: any) => {
    counters.openSession += 1
    return {
      ok: true,
      backendId: 'gitlab',
      repoRef: GITLAB_REPO,
      canWrite: !!(opts && opts.write),
      call: async (fn: (s: any, c: any) => unknown) => { counters.sessionCall += 1; return fn(session, {}) },
    }
  }
  return createCommentThreads({
    normCwd: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'gitlab', rev: 1 }),
    isComposerSelection: () => true,
    getTrackerRegistry: async () => ({ describe: () => GITLAB_REPO, modules: () => [] }),
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
  })
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

function keysOf(value: any): string[] {
  return Object.keys(value || {}).sort()
}

function sameKeys(a: any, b: any): { same: boolean; a: string[]; b: string[] } {
  const ka = keysOf(a)
  const kb = keysOf(b)
  return { same: ka.join('|') === kb.join('|'), a: ka, b: kb }
}

function groupsOf(issue: any): any {
  return (issue && issue.snapshotGroups) || {}
}

/**
 * 列表读结果。updatedAt 可给：C 组要用「更晚的更新时间 + 更早的取数时刻」把列表组压旧。
 * 为什么必须更晚：#1931 起读结果的行组按「更新时间严格更新才覆盖」判，同一时刻的重写会被跳过，
 * 于是取数时刻（last_queried_ms）也不会被推新，C 组想造的「列表组已旧」就不成立。
 */
function listRows(updatedAt?: string): Issue[] {
  const rows = [
    gitlabIssue({ key: '100', type: 'map', title: '探索地图：GitLab 首屏', labels: [{ name: 'wayfinder:map', color: '5319e7' }] }),
    gitlabIssue({ key: '5', title: '子票五', parentKey: '100', labels: [{ name: 'ready-for-agent', color: 'ededed' }], assignees: [{ login: 'alice' }], blockedBy: [{ key: '50', title: '已关闭的子票', state: 'closed' }] }),
    gitlabIssue({ key: '200', type: 'spec', title: '规格：GitLab 支路' }),
    gitlabIssue({ key: '6', title: '规格子票', parentKey: '200' }),
    gitlabIssue({ key: '7', title: '独立票', labels: [{ name: 'bug', color: 'd73a4a' }], assignees: [{ login: 'bob' }] }),
  ]
  return updatedAt ? rows.map((row) => Object.assign({}, row, { updatedAt })) : rows
}

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1867-gitlab-'))
  const tempRootGh = mkdtempSync(path.join(os.tmpdir(), 'verify-1867-github-'))
  try {
    for (const root of [tempRoot, tempRootGh]) {
      mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
      writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1867\n', 'utf8')
    }

    // ── A. 第一次首屏：composer 支路取回 GitLab 列表，按批写进库 ───────────────────
    const countersA = newCounters()
    const cacheA = new Map<string, any>()
    const hostA = gitlabPhone({ root: tempRoot, rows: listRows(), detail: gitlabDetail(), counters: countersA, cache: cacheA })
    const first: any = await hostA.phone.handleSnapshot({ cwd: tempRoot, backendId: 'gitlab' })
    check(first && first.ok === true, 'A1 GitLab 首屏在线组装成功', first)
    check(countersA.list >= 1, 'A2 第一次真的走了一趟列表取数（composer 支路）', countersA)
    const replayA = await snapshotLibrary.readSnapshotReplay({ workspaceRoot: tempRoot, backend: 'gitlab', repoIdentity: GITLAB_REPO.refId, repo: GITLAB_REPO })
    check(replayA !== null && replayA.rows === 5, 'A3 GitLab 列表批次写进了库（五张票）', replayA && replayA.rows)
    check(replayA !== null && !!findContainer(replayA.snapshot, '100') && !!findContainer(replayA.snapshot, '200'), 'A4 地图与规格两个容器都在库里', replayA && keysOf(replayA.snapshot))
    check(replayA !== null && !!findTicket(findContainer(replayA.snapshot, '100'), '5'), 'A5 子票按父子边挂在容器下', replayA && findContainer(replayA.snapshot, '100'))
    check(countersA.diskWrite === 0, 'A6 GitLab 首屏不再写旧磁盘快照', countersA)
    check(hostA.adopted.snap && hostA.adopted.snap.ok === true && hostA.adopted.snap.fromCache !== true, 'A7 第一次是新鲜数据，不是回放', hostA.adopted.snap && hostA.adopted.snap.fromCache)

    // ── B. 断网重启：首屏只从库出，联网口全部计数 ─────────────────────────────────
    snapshotLibrary.closeSnapshotLibraries()
    const countersB = newCounters()
    const cacheB = new Map<string, any>()
    const hostB = gitlabPhone({ root: tempRoot, rows: listRows(), detail: gitlabDetail(), counters: countersB, cache: cacheB, failList: true })
    const second: any = await hostB.phone.handleSnapshot({ cwd: tempRoot, backendId: 'gitlab' })
    check(second && second.ok === true, 'B1 断网重启后首屏成功', second)
    const snapB: any = hostB.adopted.snap || (second && second.snapshot)
    check(snapB && snapB.fromCache === true, 'B2 回包标了 fromCache（没走在线重建）', snapB && snapB.fromCache)
    check(snapB && snapB.diskReplay && snapB.diskReplay.schema === 'snapshot-sqlite-v1' && snapB.diskReplay.source === 'sqlite', 'B3 回包带 diskReplay 注记', snapB && snapB.diskReplay)
    check(!!(snapB && typeof snapB.diskReplay.lastKnownAtMs === 'number' && snapB.diskReplay.lastKnownAtMs > 0), 'B4 回包带上次已知时刻')
    check(!!findContainer(snapB, '100') && !!findContainer(snapB, '200'), 'B5 地图与规格容器树从库铺出')
    const ticket5 = findTicket(findContainer(snapB, '100'), '5')
    check(!!ticket5 && ticket5.labels && ticket5.labels[0].name === 'ready-for-agent', 'B6 标签随首屏从库出', ticket5 && ticket5.labels)
    check(!!ticket5 && ticket5.claimedBy === 'alice', 'B7 认领人随首屏从库出', ticket5 && ticket5.claimedBy)
    check(!!ticket5 && Array.isArray(ticket5.blockedBy) && String(ticket5.blockedBy[0]) === '50', 'B8 阻塞胶囊保留目标票号', ticket5 && ticket5.blockedBy)
    check(!!findIssue(snapB, '7'), 'B9 独立票从库铺出')
    check(countersB.list === 0 && countersB.listPage === 0 && countersB.sessionCall === 0, 'B10 没有列表取数、没有分页、没有会话调用', countersB)
    check(countersB.exec === 0 && countersB.currentUser === 0, 'B11 没有执行命令、没有问当前用户', countersB)
    check(countersB.diskRead === 0 && countersB.diskWrite === 0, 'B12 没有读写旧磁盘快照', countersB)

    // ── C. 详情：先把列表的组时刻压旧，再打开详情，host 必须取一次并写库 ─────────
    snapshotLibrary.closeSnapshotLibraries()
    const oldNow = Date.now
    const shift = 10 * 60 * 1000
    try {
      Date.now = () => oldNow() - shift
      await snapshotLibrary.recordIssueRows({ workspaceRoot: tempRoot, backend: 'gitlab', repoIdentity: GITLAB_REPO.refId, rows: listRows('2026-11-05T00:00:00Z') })
    } finally {
      Date.now = oldNow
    }
    const countersC = newCounters()
    const threadsC = gitlabThreads({ rows: listRows(), detail: gitlabDetail(), counters: countersC })
    const detailC: any = await threadsC.handleIssueDetail({ number: 5, cwd: tempRoot })
    check(detailC && detailC.ok === true, 'C1 GitLab 详情读成功', detailC)
    check(countersC.get === 1, 'C2 列表组已旧：详情真的取了一次', countersC)
    check(detailC && detailC.issue && detailC.issue.body === '这是 GitLab 票的正文。', 'C3 交回的详情带正文', detailC && detailC.issue && detailC.issue.body)
    const storedC = await snapshotLibrary.readIssueDetail({ workspaceRoot: tempRoot, backend: 'gitlab', repoIdentity: GITLAB_REPO.refId, key: '5' })
    check(!!storedC && storedC.issue?.body === '这是 GitLab 票的正文。', 'C4 详情正文按组落库', storedC && storedC.issue && storedC.issue.body)
    check(!!storedC && storedC.issue?.groups.comments?.completeness === 'complete', 'C5 评论组是完整的（1/1 条都取到了）', storedC && storedC.issue && storedC.issue.groups.comments)
    check(!!storedC && storedC.issue?.parents[0]?.key === '100' && storedC.issue?.blockedBy[0]?.key === '50', 'C6 关系从同一张边表写入', storedC && storedC.issue && { parents: storedC.issue.parents, blockedBy: storedC.issue.blockedBy })

    const detailIssueC: any = storedC && storedC.issue
    const subGroup = detailIssueC && detailIssueC.groups.subIssues
    const reviewGroup = detailIssueC && detailIssueC.groups.review
    const mergeGroup = detailIssueC && detailIssueC.groups.mergeInfo
    check(!!subGroup && subGroup.completeness === 'unknown' && subGroup.reason === 'not-applicable', 'C7 GitLab 没有子票计数：写 unknown/not-applicable，不写完整空值', subGroup)
    check(!!reviewGroup && reviewGroup.completeness === 'unknown' && reviewGroup.reason === 'not-applicable', 'C8 GitLab 没有评审：写 unknown/not-applicable', reviewGroup)
    check(!!mergeGroup && mergeGroup.completeness === 'unknown' && mergeGroup.reason === 'not-applicable', 'C9 GitLab 没有合并信息：写 unknown/not-applicable', mergeGroup)
    check(!!storedC && storedC.issue?.subIssues === null && storedC.issue?.mergedAtMs === null, 'C10 库里没有把能力差异写成「确认没有」', storedC && storedC.issue && { subIssues: storedC.issue.subIssues, mergedAtMs: storedC.issue.mergedAtMs })

    // ── D. 重启后详情与关系从库出，不再发取数 ─────────────────────────────────────
    snapshotLibrary.closeSnapshotLibraries()
    const countersD = newCounters()
    const threadsD = gitlabThreads({ rows: listRows(), detail: gitlabDetail(), counters: countersD })
    const detailD: any = await threadsD.handleIssueDetail({ number: 5, cwd: tempRoot })
    check(detailD && detailD.ok === true && detailD.fromSnapshot === true, 'D1 重启后详情从库出', detailD && detailD.fromSnapshot)
    check(countersD.get === 0, 'D2 重启后没有重取详情', countersD)
    check(detailD && detailD.issue && detailD.issue.body === '这是 GitLab 票的正文。', 'D3 重启后正文还在', detailD && detailD.issue && detailD.issue.body)
    check(detailD && detailD.issue && detailD.issue.comments && detailD.issue.comments.nodes.length === 1, 'D4 重启后评论从库出', detailD && detailD.issue && detailD.issue.comments)
    check(detailD && detailD.issue && detailD.issue.blockedBy && detailD.issue.blockedBy.nodes[0].number === 50, 'D5 重启后阻塞关系从库出', detailD && detailD.issue && detailD.issue.blockedBy)
    check(detailD && detailD.issue && groupsOf(detailD.issue).review && groupsOf(detailD.issue).review.reason === 'not-applicable', 'D6 回包把「不适用」原样带给界面', detailD && groupsOf(detailD.issue).review)

    // ── E. 写回执（评论）也走同一个库：发出去之后库里多一条 ───────────────────────
    const countersE = newCounters()
    const threadsE = gitlabThreads({ rows: listRows(), detail: gitlabDetail(), counters: countersE })
    const posted: any = await threadsE.handleCommentIssue({ number: 5, body: '新评论', cwd: tempRoot })
    check(posted && posted.ok === true && posted.stored === true, 'E1 GitLab 发评论成功并提交进库', posted && { ok: posted.ok, stored: posted.stored })
    check(countersE.comment === 1, 'E2 写会话真的发了一次评论', countersE)
    const afterWrite = await snapshotLibrary.readIssueDetail({ workspaceRoot: tempRoot, backend: 'gitlab', repoIdentity: GITLAB_REPO.refId, key: '5' })
    check(!!afterWrite && afterWrite.issue?.comments.length === 2, 'E3 新评论落进库（原来一条 + 新的一条）', afterWrite && afterWrite.issue && afterWrite.issue.comments.length)
    check(!!afterWrite && afterWrite.issue?.comments[1]?.body === '新评论', 'E4 库里的新评论正文与回执一致', afterWrite && afterWrite.issue && afterWrite.issue.comments[1])

    // ── F. 与 GitHub 同类的数据形状一致 ───────────────────────────────────────────
    await snapshotLibrary.recordIssueRows({ workspaceRoot: tempRootGh, backend: 'github', repoIdentity: GITHUB_REPO.refId, rows: listRows().map((row) => Object.assign({}, row, { url: 'https://github.com/acme/widgets/issues/' + row.key })) })
    const gitlabReplay = await snapshotLibrary.readSnapshotReplay({ workspaceRoot: tempRoot, backend: 'gitlab', repoIdentity: GITLAB_REPO.refId, repo: GITLAB_REPO })
    const githubReplay = await snapshotLibrary.readSnapshotReplay({ workspaceRoot: tempRootGh, backend: 'github', repoIdentity: GITHUB_REPO.refId, repo: GITHUB_REPO })
    check(gitlabReplay !== null && githubReplay !== null, 'F1 两端的库都能回放')
    const mapGitlab = findContainer(gitlabReplay && gitlabReplay.snapshot, '100')
    const mapGithub = findContainer(githubReplay && githubReplay.snapshot, '100')
    const ticketShape = sameKeys(findTicket(mapGitlab, '6'), findTicket(mapGithub, '6'))
    check(ticketShape.same, 'F2 首屏子票的字段集合一致', ticketShape)
    const issueShape = sameKeys(findIssue(gitlabReplay && gitlabReplay.snapshot, '7'), findIssue(githubReplay && githubReplay.snapshot, '7'))
    check(issueShape.same, 'F3 未挂图票的字段集合一致', issueShape)
    const snapShape = sameKeys(gitlabReplay && gitlabReplay.snapshot, githubReplay && githubReplay.snapshot)
    check(snapShape.same, 'F4 快照主体顶层字段一致', snapShape)
    const detailGithub = await snapshotLibrary.readIssueDetail({ workspaceRoot: tempRootGh, backend: 'github', repoIdentity: GITHUB_REPO.refId, key: '5' })
    const detailGitlab = await snapshotLibrary.readIssueDetail({ workspaceRoot: tempRoot, backend: 'gitlab', repoIdentity: GITLAB_REPO.refId, key: '5' })
    const detailShape = sameKeys(detailGitlab && detailGitlab.issue, detailGithub && detailGithub.issue)
    check(detailShape.same, 'F5 详情投影的字段集合一致', detailShape)
    const groupShape = sameKeys(detailGitlab && detailGitlab.issue && detailGitlab.issue.groups, detailGithub && detailGithub.issue && detailGithub.issue.groups)
    check(groupShape.same, 'F6 详情十组三态的字段集合一致', groupShape)

    // ── G. 宿主取数路给 GitLab 拼的是 GitLab 身份与地址 ───────────────────────────
    let rowRef: any = null
    const gitlabList = createIssueList({
      getRepoKey: async () => null,
      setCache: () => {},
      issueIndexFromSnapshot: () => ({}),
      issueIndexChanged: () => false,
      rememberIssueIndex: () => {},
      readDiskCache: async () => null,
      logCtx: null,
      noteSnapshot: () => {},
      openSession: async () => ({ ok: true, backendId: 'gitlab', repoRef: GITLAB_REPO, call: async (fn: any) => fn(gitlabSession(listRows(), gitlabDetail(), newCounters()), {}) }),
      onIssueRows: async (_cwd: string, ref: RepositoryRef) => { rowRef = ref },
    })
    const listed: any = await gitlabList.fetchIssues(tempRoot)
    check(listed && listed.ok === true && (listed.issues || []).length === 5, 'G1 宿主列表路认得出 GitLab 仓库（不再要求 GitHub owner/name）', listed && listed.error)
    check(!!rowRef && rowRef.backend === 'gitlab' && rowRef.refId === GITLAB_REPO.refId, 'G2 写库身份用 GitLab 的 refId', rowRef)
    check(!!rowRef && typeof rowRef.url === 'string' && rowRef.url.indexOf('https://gitlab.com/') === 0, 'G3 仓库地址是 GitLab 的，不是 GitHub 的', rowRef && rowRef.url)

    // ── H. 客户端没有第二份持久快照（GitLab 与 GitHub 共用同一份实现）───────────────
    const clientDir = path.join(ROOT, 'src', 'refresh', 'rooms', 'client')
    const storeFile = path.join(clientDir, 'snapshot-cache-store.ts')
    const storeText = readFileSync(storeFile, 'utf8')
    check(storeText.indexOf('indexedDB') < 0, 'H1 共享的客户端快照存储不再碰 IndexedDB')
    check(storeText.indexOf('diskPutSnapshot') < 0 && storeText.indexOf('diskGetSnapshot') < 0 && storeText.indexOf('SNAP_DISK_CAP') < 0, 'H2 客户端持久快照的三个口已删除（#1870：不再是留白的空操作）')
    const clientFiles = readdirSync(clientDir, { recursive: true })
      .map((rel) => path.join(clientDir, String(rel)))
      .filter((file) => file.endsWith('.ts'))
    const withIdb = clientFiles.filter((file) => readFileSync(file, 'utf8').indexOf('indexedDB') >= 0)
    check(withIdb.length === 0, 'H3 客户端目录里没有第二份 IndexedDB 持久快照', withIdb)

    // 清掉 GitLab 一侧的库句柄；两个临时目录由 finally 收掉。
    snapshotLibrary.closeSnapshotLibraries()
  } finally {
    snapshotLibrary.closeSnapshotLibraries()
    rmSync(tempRoot, { recursive: true, force: true })
    rmSync(tempRootGh, { recursive: true, force: true })
  }
  printGateResult(GATE, total, failed)
}

main().catch((e) => {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exitCode = 1
})
