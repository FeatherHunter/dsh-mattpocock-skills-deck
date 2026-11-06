/**
 * tests/verify-1863-snapshot-cold-start.ts —— 断网冷启动首屏只读快照库（#1863）
 *
 * 守什么（票面五条验收里挑首屏这一条）：GitHub 的列表批次（地图、全量列表、索引分页）先按组写进
 * 本地快照库；随后把网络全部掐掉（在线探测、磁盘缓存、当前用户、开会话、执行命令五处都装计数器），
 * 首屏仍然从库里铺出地图/规格容器树、子票与状态胶囊，回包带 fromCache 与 diskReplay 注记。
 *
 * 为什么用真 SQLite 与真临时工作区：写库与回放要穿过真正的快照树；替身盖不住按组合并与父子边。
 * 宿主那一层用假依赖装配 createSessionSnapshot（与 tests/verify-snapshot-cache-first.ts 同法），
 * 只把「会不会联网」变成可数的断言。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1863-snapshot-cold-start.ts
 */
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/issue-list-fetch.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { createSessionSnapshot } from '../src/refresh/rooms/host/session-snapshot-cache.ts'
import { createIssueList } from '../src/refresh/rooms/host/issue-list-fetch.ts'
import { recordIssueRows, readSnapshotReplay, closeSnapshotLibraries } from '../src/refresh/rooms/host/snapshot-library.ts'

const GATE = 'verify-1863-snapshot-cold-start'
const REPO: RepositoryRef = {
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

function issue(input: Partial<Issue> & { key: string; title: string }): Issue {
  const base: Issue = {
    key: input.key,
    effortId: input.effortId || '',
    type: input.type || 'issue',
    title: input.title,
    state: input.state || 'open',
    body: input.body || '',
    url: 'https://github.com/acme/widgets/issues/' + input.key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: input.updatedAt || '2026-11-01T00:00:00Z',
    closedAt: input.closedAt || null,
    parentKey: input.parentKey === undefined ? null : input.parentKey,
  }
  return Object.assign(base, input)
}

function findContainer(snap: any, key: string): any {
  return (snap.maps || []).filter((m: any) => String(m.key) === key)[0]
}

function findTicket(container: any, key: string): any {
  return ((container && container.tickets) || []).filter((t: any) => String(t.key) === key)[0]
}

function findIssue(snap: any, key: string): any {
  return (snap.issues || []).filter((x: any) => String(x.key) === key)[0]
}

function upcaseSnapStates(snap: any): any {
  const up = (row: any) => { if (row && row.state) row.state = String(row.state).toUpperCase(); return row }
  ;(snap.maps || []).forEach((m: any) => { up(m); (m.tickets || []).forEach(up) })
  ;(snap.issues || []).forEach(up)
  return snap
}

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1863-cold-'))
  try {
    mkdirSync(path.join(tempRoot, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1863-cold\n')

    const map100 = issue({ key: '100', type: 'map', title: '探索地图：首屏' })
    const child5 = issue({
      key: '5', title: '子票五', parentKey: '100',
      labels: [{ name: 'ready-for-agent', color: 'ededed' }],
      assignees: [{ login: 'alice' }],
      blockedBy: [{ key: '50', title: '已关闭的子票', state: 'closed', type: 'issue' }],
    })
    const closed50 = issue({ key: '50', title: '已关闭的子票', state: 'closed', parentKey: '100', closedAt: '2026-10-20T00:00:00Z' })
    const spec200 = issue({ key: '200', type: 'spec', title: '规格：快照库' })
    const child6 = issue({ key: '6', title: '规格子票', parentKey: '200' })
    const lone7 = issue({ key: '7', title: '独立票', labels: [{ name: 'bug', color: 'd73a4a' }], assignees: [{ login: 'bob' }], status: 'In Progress', statusVisible: 'visible' })
    const pr99 = issue({ key: '99', title: '拉取请求也在库里', isPullRequest: true })
    let allRows: Issue[] = [map100, child5, closed50, spec200, child6, lone7, pr99]
    const pages: Issue[][] = [[map100, child5, closed50], [spec200, child6, lone7]]

    // ── A. 列表三条取数路径（地图 / 全量 / 索引分页）把每一批写进库 ───────────────────────────
    const writes: any[] = []
    const session = {
      list: async (_ref: unknown, filter: any) => {
        const rows = filter && filter.labels ? [map100] : allRows
        return { ok: true, data: rows }
      },
      listPage: async (_ref: unknown, _filter: unknown, opts: any) => {
        const index = opts && opts.cursor ? 1 : 0
        return { ok: true, data: { items: pages[index] || [], nextCursor: index === 0 ? 'c1' : null, total: 7 } }
      },
    }
    const list = createIssueList({
      getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
      setCache: () => {},
      issueIndexFromSnapshot: () => ({}),
      issueIndexChanged: () => false,
      rememberIssueIndex: () => {},
      readDiskCache: async () => null,
      logCtx: null,
      noteSnapshot: () => {},
      openSession: async () => ({ ok: true, backendId: 'github', call: async (fn: any) => fn(session, {}) }),
      onIssueRows: async (cwd: string, ref: RepositoryRef, rows: Issue[]) => {
        const r = await recordIssueRows({ workspaceRoot: cwd, backend: String(ref.backend), repoIdentity: String(ref.refId), rows })
        writes.push(r)
      },
    })

    const mapsRes = await list.fetchMaps(tempRoot)
    check(mapsRes.ok === true && (mapsRes.maps || []).length === 1, 'A1 地图取数成功（一批一张）', mapsRes)
    const issuesRes = await list.fetchIssues(tempRoot)
    check(issuesRes.ok === true && (issuesRes.issues || []).length === 6, 'A2 全量列表成功（PR 不进列表视图）', issuesRes)
    const indexRes = await list.fetchIssueIndex(tempRoot)
    check(indexRes.ok === true && indexRes.pages === 2 && indexRes.count === 6, 'A3 索引翻两页取全六张', indexRes)
    check(writes.length === 4 && writes.every((w: any) => w.ok === true), 'A4 四个批次（地图/全量/两页）都写库成功', writes)

    const replay0 = await readSnapshotReplay({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId, repo: REPO })
    // #1870：拉取请求也在库里。从前这里按「面板快照从不展示 PR」把它们滤掉，而组装层其实照收，
    // 面板的拉取请求页签读的正是这一行——滤掉之后，库成为显示来源就等于页签空了。
    check(replay0 !== null && replay0.rows === 7, 'A5 库里七张票（拉取请求与工单一样落库）', replay0 && replay0.rows)
    const replayPr = replay0 ? findIssue(replay0.snapshot, '99') : undefined
    check(!!replayPr && replayPr.isPullRequest === true, 'A5b 拉取请求带着 isPullRequest 回放（页签靠它认出这是 PR）', replayPr)
    check(replay0 !== null && findContainer(replay0.snapshot, '100') !== undefined && findContainer(replay0.snapshot, '200') !== undefined,
      'A6 地图与规格两个容器都在库里')
    check(replay0 !== null && replay0.mergeVersion > 0, 'A7 合并版本号已推进')

    // ── B. 断网冷启动：五处联网口全部计数，首屏只能来自库 ─────────────────────────────────────
    const net = { cacheIsCurrent: 0, diskRead: 0, diskWrite: 0, currentUser: 0, openSession: 0, exec: 0 }
    const memoryCache = new Map<string, any>()
    let adopted: any = null
    const reg = {
      describe: () => REPO,
      modules: () => [],
      get: () => ({ getCurrentUser: async () => { net.currentUser += 1; return { ok: true, data: { login: 'octo' } } } }),
    }
    const snapshotPhone = createSessionSnapshot({
      canonicalKey: async (c: unknown) => String(c),
      selectEarly: async () => ({ backendId: 'github', rev: 1 }),
      isComposerSelection: () => false,
      getTrackerRegistry: async () => reg,
      getPlatform: async () => ({}),
      ctx: { get: () => null },
      getCache: (c: string) => memoryCache.get(c) || { ts: 0, snapshot: null },
      setCache: (v: any) => { memoryCache.set(v.cwd, { ts: v.ts, snapshot: v.snapshot }) },
      CACHE_MS: 60000,
      cacheSnapshotIsCurrent: async () => { net.cacheIsCurrent += 1; return false },
      upcaseSnapStates,
      computeLevels: () => ({ byNumber: {}, byKey: {} }),
      groupTickets: (tickets: any[]) => ({ total: tickets.length, open: tickets.filter((t) => t.state !== 'CLOSED').length, closed: tickets.filter((t) => t.state === 'CLOSED').length, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
      getRepoRoot: async () => tempRoot,
      getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
      readDiskCache: async () => { net.diskRead += 1; return null },
      writeDiskCache: () => { net.diskWrite += 1 },
      adoptSnapshot: (snap: any) => { adopted = snap; return snap },
      detectionExec: () => { net.exec += 1; throw new Error('断网时不该发命令') },
      getGhPath: () => null,
      getGhLastError: () => null,
      errText: (e: any) => String((e && e.message) || e),
      getSnapshotLibrary: async () => ({ readSnapshotReplay, recordIssueRows }),
    })

    const first = await snapshotPhone.handleSnapshot({ cwd: tempRoot, backendId: 'github' })
    check(first && first.ok === true, 'B1 冷启动快照成功（网络全断）', first && first.ok)
    const snap = (adopted || first.snapshot) as any
    check(snap && snap.fromCache === true, 'B2 回包标了 fromCache（没走整份重建）')
    check(snap && snap.diskReplay && snap.diskReplay.schema === 'snapshot-sqlite-v1' && snap.diskReplay.source === 'sqlite',
      'B3 回包带 diskReplay 注记（schema / source）', snap && snap.diskReplay)
    check(!!(snap && typeof snap.diskReplay.lastKnownAtMs === 'number' && snap.diskReplay.lastKnownAtMs > 0),
      'B4 回包带上次已知时刻')
    check(!!findContainer(snap, '100') && !!findContainer(snap, '200'), 'B5 地图与规格容器树从库铺出')
    const prView = findIssue(snap, '99')
    check(!!prView && prView.isPullRequest === true, 'B5b 首屏里也有那张拉取请求（页签与详情都读得到它）', prView)
    const map100View = findContainer(snap, '100')
    check(!!findTicket(map100View, '5') && !!findTicket(map100View, '50'), 'B6 子票（含已关闭）挂在父容器下')
    const ticket5 = findTicket(map100View, '5')
    check(!!ticket5 && ticket5.labels && ticket5.labels[0] && ticket5.labels[0].name === 'ready-for-agent', 'B7 标签随首屏从库出', ticket5 && ticket5.labels)
    check(!!ticket5 && ticket5.claimedBy === 'alice', 'B8 认领人随首屏从库出', ticket5 && ticket5.claimedBy)
    check(!!ticket5 && Array.isArray(ticket5.blockedBy) && ticket5.blockedBy[0] === '50', 'B9 阻塞胶囊保留目标票号', ticket5 && ticket5.blockedBy)
    check(!!findTicket(map100View, '50') && findTicket(map100View, '50').state === 'CLOSED', 'B10 已关闭票的状态胶囊为 CLOSED')
    check(!!findTicket(findContainer(snap, '200'), '6'), 'B11 规格容器的子票也从库出')
    const loneView = findIssue(snap, '7')
    check(!!loneView && loneView.state === 'OPEN' && loneView.status === 'In Progress' && loneView.statusVisible === 'visible', 'B12 独立票的状态字段从库出', loneView)
    check(!!findContainer(snap, '100') && findContainer(snap, '100').number === 100, 'B13 容器补出了旧视图要的数字编号')
    check(net.cacheIsCurrent === 0 && net.diskRead === 0 && net.diskWrite === 0, 'B14 没有在线探测、没有读磁盘缓存、没有写磁盘缓存', net)
    check(net.currentUser === 0 && net.openSession === 0 && net.exec === 0, 'B15 没有问当前用户、没有开会话、没有执行命令', net)
    // #1887：库回放的 deck 现在带六个数字 + 完整度（不再是 null）；它来自库的一次查询，不冒充后端计数。
  check(!!snap && !!snap.deck && !!snap.deck.counts && !('countsPending' in snap.deck), 'B16 库回放带库算的六个数字（不冒充后端计数、也不留待校准）', snap && snap.deck)

    // ── C. 增量：再取一批只覆盖提到的票，首屏立刻看到新值，没提到的仍在 ─────────────────────────
    // #1931：标题改过的那一行必须带一个更晚的 updatedAt —— 读结果行组只在「严格更新」时才覆盖。
    const child5b = Object.assign({}, child5, { title: '子票五（改过）', updatedAt: '2026-11-02T00:00:00Z' })
    const child8 = issue({ key: '8', title: '新子票', parentKey: '100' })
    allRows = [map100, child5b, closed50, spec200, child6, lone7, pr99, child8]
    const again = await list.fetchIssues(tempRoot)
    check(again.ok === true, 'C1 第二批全量列表成功', again)
    const replay1 = await readSnapshotReplay({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId, repo: REPO })
    check(replay1 !== null && replay1.mergeVersion > replay0!.mergeVersion, 'C2 增量写入推进合并版本号', replay1 && [replay0!.mergeVersion, replay1.mergeVersion])
    const second = await snapshotPhone.handleSnapshot({ cwd: tempRoot, backendId: 'github' })
    check(second && second.ok === true, 'C3 增量后首屏仍成功', second && second.ok)
    const snap2 = (adopted || second.snapshot) as any
    check(!!findTicket(findContainer(snap2, '100'), '5') && findTicket(findContainer(snap2, '100'), '5').title === '子票五（改过）',
      'C4 后写的标题覆盖前值')
    check(!!findTicket(findContainer(snap2, '100'), '8'), 'C5 第二批的新子票挂进同一容器')
    check(!!findTicket(findContainer(snap2, '100'), '50'), 'C6 第二批没提到的已关闭票仍在')

    // ── D. 整池批次只带开放票：已关闭票不被删 ─────────────────────────────────────────────
    const fullPool = await recordIssueRows({
      workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId,
      rows: [map100, child5b, spec200, child6, lone7],
    })
    check(fullPool.ok === true && fullPool.rows === 5, 'D1 整池批次（只带开放票）写入成功', fullPool)
    const replay2 = await readSnapshotReplay({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId, repo: REPO })
    check(replay2 !== null && !!findTicket(findContainer(replay2.snapshot, '100'), '50'), 'D2 整池重建后已关闭票仍在库里')
    check(replay2 !== null && !!findTicket(findContainer(replay2.snapshot, '100'), '8'), 'D3 整池批次没提到的票也不被删')

    const final = await snapshotPhone.handleSnapshot({ cwd: tempRoot, backendId: 'github' })
    check(final && final.ok === true, 'D4 整池批次后首屏仍从库出', final && final.ok)
  } finally {
    closeSnapshotLibraries()
    rmSync(tempRoot, { recursive: true, force: true })
  }
  printGateResult(GATE, total, failed)
}

main().catch((e) => {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exitCode = 1
})
