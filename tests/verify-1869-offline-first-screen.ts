/**
 * tests/verify-1869-offline-first-screen.ts —— 三端首屏只靠快照库，断网时一个联网口都不许碰（#1869）
 *
 * 守什么（票面「断网门禁在无网络条件下通过，任何新增联网依赖都会让它变红」一条）：
 *   A. GitHub：先把列表批次写进真 SQLite，再关掉句柄、装上一组「一调用就抛错」的联网口桩，首屏仍然
 *      从库铺出容器树、子票、标签、认领人与阻塞胶囊，回包标 fromCache 与 diskReplay。
 *   B. GitLab：同一个口径，走 composer 支路；仓库身份由 describe 给出，不需要开会话。
 *   C. 本地 Markdown：同一个口径；票号补零、工作单元标识取自目录名这两格也随首屏从库出。
 *   D. 每端跑完都断言：票面点名的联网口（开会话、会话调用、执行命令、问当前用户、读旧磁盘快照、
 *      写旧磁盘快照）加上发送外呼、在线探测两处，以及全局 fetch，调用次数都是 0（见 A12 / B12 / C12）。
 *      开会话与随后的会话调用共用一套桩：开会话先记一笔，再交回一个所有方法都抛错的会话；调用方
 *      无论只开会话还是接着 call，都会先记账再抛错。
 *
 * 为什么桩要「先计数再抛错」而不是只计数：只计数时，代码若把抛错吞掉、改走另一条联网路，计数仍是
 * 0，门禁会假绿；先记一笔再抛，任何一次触碰都会留下痕迹。为什么还要拦全局 fetch：现有三扇门禁只
 * 拦插件自己的六个口；新代码若绕过这些口直接 fetch，这一扇要能当场变红。
 *
 * 为什么用真 SQLite 与真临时工作区：写库与回放要穿过真正的快照树（按组合并、父子边、三态），替身
 * 盖不住这些；首屏那条装配用与 tests/verify-1863-snapshot-cold-start.ts 相同的方式接假依赖。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1869-offline-first-screen.ts
 */
// 门禁归属: src/refresh/rooms/host/snapshot-library-first-screen.ts
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { createSessionSnapshot } from '../src/refresh/rooms/host/session-snapshot-cache.ts'
import * as snapshotLibrary from '../src/refresh/rooms/host/snapshot-library.ts'

const GATE = 'verify-1869-offline-first-screen'
const MARKDOWN_EFFORT = 'alpha'
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

/** 联网口的调用次数。所有值都必须停在 0：断网时首屏只读库。 */
interface NetCalls {
  openSession: number
  sessionCall: number
  send: number
  detectionExec: number
  currentUser: number
  cacheIsCurrent: number
  diskRead: number
  diskWrite: number
  fetch: number
}

function newNetCalls(): NetCalls {
  return { openSession: 0, sessionCall: 0, send: 0, detectionExec: 0, currentUser: 0, cacheIsCurrent: 0, diskRead: 0, diskWrite: 0, fetch: 0 }
}

function issueBase(input: Partial<Issue> & { key: string; title: string; url: string }): Issue {
  const base: Issue = {
    key: input.key,
    effortId: input.effortId || '',
    type: input.type || 'issue',
    title: input.title,
    state: input.state || 'open',
    body: input.body || '',
    url: input.url,
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

function githubIssue(input: Partial<Issue> & { key: string; title: string }): Issue {
  return issueBase(Object.assign({}, input, { url: 'https://github.com/acme/widgets/issues/' + input.key }))
}

function gitlabIssue(input: Partial<Issue> & { key: string; title: string }): Issue {
  return issueBase(Object.assign({}, input, { url: 'https://gitlab.com/acme/project/-/issues/' + input.key }))
}

function markdownIssue(input: Partial<Issue> & { key: string; title: string }): Issue {
  // 本地 Markdown 的票面地址由房间自己填；工作单元标识就是目录名。
  return issueBase(Object.assign({}, input, { url: '', effortId: MARKDOWN_EFFORT }))
}

function githubRows(): Issue[] {
  return [
    githubIssue({ key: '100', type: 'map', title: '探索地图：GitHub 首屏', labels: [{ name: 'wayfinder:map', color: '5319e7' }] }),
    githubIssue({ key: '5', title: '子票五', parentKey: '100', labels: [{ name: 'ready-for-agent', color: 'ededed' }], assignees: [{ login: 'alice' }], blockedBy: [{ key: '50', title: '已关闭的子票', state: 'closed' }] }),
    githubIssue({ key: '200', type: 'spec', title: '规格：GitHub 支路' }),
    githubIssue({ key: '6', title: '规格子票', parentKey: '200' }),
    githubIssue({ key: '7', title: '独立票', labels: [{ name: 'bug', color: 'd73a4a' }], assignees: [{ login: 'bob' }] }),
  ]
}

function gitlabRows(): Issue[] {
  return [
    gitlabIssue({ key: '100', type: 'map', title: '探索地图：GitLab 首屏', labels: [{ name: 'wayfinder:map', color: '5319e7' }] }),
    gitlabIssue({ key: '5', title: '子票五', parentKey: '100', labels: [{ name: 'ready-for-agent', color: 'ededed' }], assignees: [{ login: 'alice' }], blockedBy: [{ key: '50', title: '已关闭的子票', state: 'closed' }] }),
    gitlabIssue({ key: '200', type: 'spec', title: '规格：GitLab 支路' }),
    gitlabIssue({ key: '6', title: '规格子票', parentKey: '200' }),
    gitlabIssue({ key: '7', title: '独立票', labels: [{ name: 'bug', color: 'd73a4a' }], assignees: [{ login: 'bob' }] }),
  ]
}

function markdownRows(): Issue[] {
  return [
    markdownIssue({ key: '00', type: 'map', title: '探索地图：本地 Markdown 首屏', labels: [{ name: 'wayfinder:map', color: '5319e7' }] }),
    markdownIssue({ key: '01', title: '第一张子票', parentKey: '00', labels: [{ name: 'ready-for-agent', color: 'ededed' }], assignees: [{ login: 'alice', name: '爱丽丝' }], blockedBy: [{ key: '05', title: '独立票', state: 'open' }] }),
    markdownIssue({ key: '10', type: 'spec', title: '规格：本地 Markdown 支路' }),
    markdownIssue({ key: '11', title: '规格子票', parentKey: '10' }),
    markdownIssue({ key: '05', title: '独立票', labels: [{ name: 'bug', color: 'd73a4a' }] }),
  ]
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

function findContainer(snap: any, key: string): any {
  return ((snap && snap.maps) || []).filter((m: any) => String(m.key) === key)[0]
}

function findTicket(container: any, key: string): any {
  return ((container && container.tickets) || []).filter((t: any) => String(t.key) === key)[0]
}

function findIssue(snap: any, key: string): any {
  return ((snap && snap.issues) || []).filter((x: any) => String(x.key) === key)[0]
}

interface BackendCase {
  label: string
  backend: 'github' | 'gitlab' | 'markdown'
  repo: RepositoryRef
  rows: Issue[]
  containerKey: string
  childKey: string
  loneKey: string
  blockedMatches: (value: unknown) => boolean
  composer: boolean
}

/**
 * 跑一端的完整断网首屏：写库 → 关句柄（模拟进程重启）→ 装抛错桩 → 从库铺首屏。
 *
 * 联网口桩统一做两件事：先 net.<名字> += 1，再抛错。计数是给「抛错被上层吞掉、又走别的路」留证据；
 * 抛错是给「代码根本没有兜住」当场判红。两者缺一都会让门禁出现假绿。
 */
async function runBackendCase(root: string, c: BackendCase): Promise<void> {
  const prefix = c.label
  const key = { workspaceRoot: root, backend: c.backend, repoIdentity: String(c.repo.refId) }

  const seeded = await snapshotLibrary.recordIssueRows(Object.assign({ rows: c.rows }, key))
  check(seeded.ok === true && seeded.rows === c.rows.length, prefix + '1 列表批次先写进真 SQLite（' + c.rows.length + ' 张票）', seeded)
  snapshotLibrary.closeSnapshotLibraries()

  const net = newNetCalls()
  const realFetch = (globalThis as any).fetch
  ;(globalThis as any).fetch = async () => { net.fetch += 1; throw new Error('断网时不许直接 fetch') }
  try {
    const registry = {
      describe: () => c.repo,
      modules: () => [],
      get: () => ({ getCurrentUser: async () => { net.currentUser += 1; throw new Error('断网时不许问当前用户') } }),
    }
    const memoryCache = new Map<string, any>()
    let adopted: any = null
    const phone = createSessionSnapshot({
      canonicalKey: async (v: unknown) => String(v),
      selectEarly: async () => ({ backendId: c.backend, rev: 1 }),
      isComposerSelection: () => c.composer,
      getTrackerRegistry: async () => registry,
      getPlatform: async () => ({}),
      ctx: { get: () => null },
      getCache: (k: string) => memoryCache.get(k) || { ts: 0, snapshot: null },
      setCache: (v: any) => { memoryCache.set(String(v.cwd), { ts: v.ts, snapshot: v.snapshot }) },
      CACHE_MS: 60000,
      cacheSnapshotIsCurrent: async () => { net.cacheIsCurrent += 1; throw new Error('断网时不许核对远端是否变化') },
      upcaseSnapStates,
      computeLevels: () => ({ byNumber: {}, byKey: {} }),
      groupTickets: groupTicketsOf,
      getRepoRoot: async () => root,
      getRepoKey: async () => (c.backend === 'github' ? { owner: 'acme', name: 'widgets' } : null),
      readDiskCache: async () => { net.diskRead += 1; throw new Error('断网时不许读旧磁盘快照') },
      writeDiskCache: () => { net.diskWrite += 1; throw new Error('断网时不许写旧磁盘快照') },
      adoptSnapshot: (snap: unknown) => { adopted = snap; return snap },
      detectionExec: () => { net.detectionExec += 1; throw new Error('断网时不许执行命令') },
      send: async () => { net.send += 1; throw new Error('断网时不许发外呼') },
      getGhPath: () => null,
      getGhLastError: () => null,
      errText: (e: any) => String((e && e.message) || e),
      getSnapshotLibrary: async () => snapshotLibrary,
      // 开会话与随后的会话调用都要留痕：开会话先记一笔，再交回一个 call 一用就抛错的会话；调用方
      // 无论只开会话还是接着 call，都会先记账（call 还会抛错），A12 / B12 / C12 的零调用断言会当场判红。
      openSession: async () => {
        net.openSession += 1
        return {
          ok: true,
          backendId: c.backend,
          repoRef: c.repo,
          canWrite: false,
          call: async () => { net.sessionCall += 1; throw new Error('断网时不许开会话再调用') },
        }
      },
      logCtx: null,
    })

    const first: any = await phone.handleSnapshot(Object.assign({ cwd: root, backendId: c.backend }, c.backend === 'markdown' ? { effortId: MARKDOWN_EFFORT } : {}))
    check(first && first.ok === true, prefix + '2 断网后首屏成功（只靠库）', first)
    const snap: any = adopted || (first && first.snapshot)
    check(snap && snap.fromCache === true, prefix + '3 回包标了 fromCache（没有在线重建）', snap && snap.fromCache)
    check(snap && snap.diskReplay && snap.diskReplay.schema === 'snapshot-sqlite-v1' && snap.diskReplay.source === 'sqlite', prefix + '4 回包带 diskReplay 注记', snap && snap.diskReplay)
    check(!!(snap && snap.diskReplay && typeof snap.diskReplay.lastKnownAtMs === 'number' && snap.diskReplay.lastKnownAtMs > 0), prefix + '5 回包带上次已知时刻')
    check(!!findContainer(snap, c.containerKey), prefix + '6 地图容器从库铺出')
    const child = findTicket(findContainer(snap, c.containerKey), c.childKey)
    check(!!child, prefix + '7 子票按父子边从库挂到容器下')
    check(!!child && child.labels && child.labels[0] && child.labels[0].name === 'ready-for-agent', prefix + '8 标签随首屏从库出', child && child.labels)
    check(!!child && child.claimedBy === 'alice', prefix + '9 认领人随首屏从库出', child && child.claimedBy)
    check(!!child && Array.isArray(child.blockedBy) && child.blockedBy.length === 1 && c.blockedMatches(child.blockedBy[0]), prefix + '10 阻塞胶囊保留目标票号', child && child.blockedBy)
    check(!!findIssue(snap, c.loneKey), prefix + '11 没挂容器的独立票也从库铺出')

    const netTotal = Object.keys(net).reduce((sum, name) => sum + (net as any)[name], 0)
    check(netTotal === 0, prefix + '12 断网首屏全程没有碰任何联网口与旧磁盘快照', net)

    const replay = await snapshotLibrary.readSnapshotReplay(Object.assign({ repo: c.repo }, key))
    check(replay !== null && replay.rows === c.rows.length, prefix + '13 首屏之后库里仍是完整的一批（没被截断或重建）', replay && replay.rows)
  } finally {
    ;(globalThis as any).fetch = realFetch
  }
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-1869-offline-'))
  try {
    mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1869-offline\n', 'utf8')

    const githubRepo: RepositoryRef = { backend: 'github', refId: 'acme/widgets', name: 'widgets', url: 'https://github.com/acme/widgets' }
    const gitlabRepo: RepositoryRef = { backend: 'gitlab', refId: 'acme/project', name: 'project', url: 'https://gitlab.com/acme/project' }
    const markdownRepo: RepositoryRef = { backend: 'markdown', refId: root, name: 'ws', url: '', effortId: MARKDOWN_EFFORT }

    const cases: BackendCase[] = [
      { label: 'A', backend: 'github', repo: githubRepo, rows: githubRows(), containerKey: '100', childKey: '5', loneKey: '7', blockedMatches: (v) => String(v) === '50', composer: false },
      { label: 'B', backend: 'gitlab', repo: gitlabRepo, rows: gitlabRows(), containerKey: '100', childKey: '5', loneKey: '7', blockedMatches: (v) => String(v) === '50', composer: true },
      { label: 'C', backend: 'markdown', repo: markdownRepo, rows: markdownRows(), containerKey: '00', childKey: '01', loneKey: '05', blockedMatches: (v) => Number(v) === 5, composer: true },
    ]

    for (const c of cases) {
      snapshotLibrary.closeSnapshotLibraries()
      await runBackendCase(root, c)
    }
  } finally {
    snapshotLibrary.closeSnapshotLibraries()
    rmSync(root, { recursive: true, force: true })
  }
  printGateResult(GATE, total, failed)
}

main().catch((e) => {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exitCode = 1
})
