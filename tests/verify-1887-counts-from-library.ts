/**
 * tests/verify-1887-counts-from-library.ts —— 面板六个数字改由快照库一次查询算出（#1887，规格 #1885 S2）
 *
 * 守什么（票面五条验收逐条落在这里）：
 *   A 六个数字与直接查库逐项相等：真 SQLite 临时库写一张有代表性的票池（开放可接、已认领、
 *     被开放票阻塞、被已关闭票阻塞、已关闭、缺指派组、指派组只有一部分、阻塞目标不存在、
 *     拉取请求、墓碑、PR 身份未知），再用一条完全独立的 SQL 遍历数一遍，逐项比对 six 个数。
 *   B 完整度来自库的同步簿记：整仓完整枚举标记没写过 = 「已知」，写过 = 「完整」；关库重开后仍在。
 *   C 改一行状态之后（不等任何校准），数字立刻反映新值：真库上改一张票的状态，再查一次计数。
 *   D 宿主一次计数请求都不发：假后端把 counts 电话记一笔（这里应恒为 0），首屏在线重建后
 *     回包里的 deck.counts 与直接查库逐项相等；已关闭的票（首屏不画）也参与统计。
 *   E 界面的 counts 切片读回这六个数 + 完整度；列表页在库没取全时显示「已知 N 张（未取全）」，
 *     「待校准」文案与标记都不再存在（中英词表一起查）。
 *   F 预算门禁：1000 张票的合成库上，六个数字一次查询 + 完整度读取取中位数 ≤ 5 毫秒；
 *     六个数字由一条 SQL 算出（用包了计数的 prepare 证明，不是数条语句拼出来的）。
 *
 * 为什么这么测：这一票要证明的是「数字从库里算、与库里的行一致」。所以 A 段不用被测代码数，
 * 而是另写一条 SQL 把行与边重新数一遍（期望值来自另一条查询，不从实现里抄）；D 段用假后端
 * 数「计数电话打了几次」——这是外部可观察的事实，不依赖内部调用顺序。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1887-counts-from-library.ts
 */
// 门禁归属: src/workspace-snapshot/projection/counts.ts
// 门禁归属: src/workspace-snapshot/runtime/open.ts
// 门禁归属: src/tracker/deck-counts.ts
// 门禁归属: src/host/tracker/snapshot.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-first-screen.ts
// 门禁归属: src/client/kernel/deck-view-binding.ts
// 门禁归属: src/client/kernel/store-derived.ts
// 门禁归属: src/client/views/ListTab.ts
// 门禁归属: config/copy/flow.yaml

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { printGateResult } from './lib/gate-result.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/runtime/open.js'
import { readCountsProjection } from '../src/workspace-snapshot/projection/counts.js'
import { closeSnapshotLibraries, readSnapshotCounts, writeSyncState } from '../src/refresh/rooms/host/snapshot-library.js'
import { createSessionSnapshot } from '../src/refresh/rooms/host/session-snapshot-cache.ts'
import * as snapshotLibrary from '../src/refresh/rooms/host/snapshot-library.js'
import { deckCountsOf, kpiCountsOf } from '../src/client/kernel/store-derived.ts'
import { applySnapshotChangeSet } from '../src/refresh/rooms/client/snapshot-change-merge.ts'
import { snapshotRowFieldsOf } from '../src/shared/snapshot-row-fields.ts'
import { createSnapshotReadChannels } from '../src/refresh/rooms/host/snapshot-read-channels.ts'
import { createIssueList } from '../src/refresh/rooms/host/issue-list-fetch.ts'
import type { IssueWrite } from '../src/workspace-snapshot/contract/types.js'

const GATE = 'verify-1887-counts-from-library'
const ROOT = process.cwd()

/**
 * 六个数字一次查询的耗时上限：5 毫秒（规格 #1885 §「预算门禁」的验收数字，同一份 1000 张票的合成库）。
 *
 * 为什么写在这里、不进 config/：它不是运行时等多久的可调参数，而是「这一次查询最多允许多慢」的
 * 验收上限；调大调小只改变门禁的严格程度，不改变插件行为。时间参数纪律管的是运行时要读的时长。
 */
const COUNTS_BUDGET_MS = 5

let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

function sourceOf(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

/** 去掉注释与字符串字面量：静态判据只认代码里真的还有那个名字。 */
function codeOnly(source: string): string {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

function makeWorkspace(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(dir, 'docs', 'agents', 'workspace.yaml'), 'name: ' + prefix + '\n', 'utf8')
  return dir
}

const IDENTITY = { backend: 'github' as const, repoIdentity: 'acme/widgets' }

/** 一张票的一批组写入：行组必写，其余按需。state 写小写（库里的口径，读回时上层再转大写）。 */
function ticket(key: string, state: string, extra?: {
  assignees?: string[] | null
  assigneesCompleteness?: 'complete' | 'truncated' | 'unknown'
  blockedBy?: string[]
  isPullRequest?: boolean | null
  title?: string
}): IssueWrite {
  const row: any = { title: (extra && extra.title) || ('票 ' + key), state, url: '', type: 'issue', isPullRequest: extra && extra.isPullRequest !== undefined ? extra.isPullRequest : false }
  const groups: any = { row: { completeness: 'complete', value: row } }
  if (extra && extra.assignees !== undefined) {
    groups.assignees = { completeness: (extra.assigneesCompleteness) || 'complete', value: (extra.assignees || []).map((login) => ({ login })) }
  }
  if (extra && extra.blockedBy !== undefined) groups.blockedBy = { completeness: 'complete', value: extra.blockedBy }
  return { effortId: '', key, groups }
}

interface Six {
  total: number
  open: number
  closed: number
  takeable: number
  blocked: number
  claimed: number
}

/**
 * 独立数一遍：完全不用被测的 counts 投影，直接用 SQL 把行、指派、阻塞边、墓碑读出来，在 JS 里数。
 *
 * 口径（与实现文档逐条对应，改口径时两处都要改）：
 *   · 只数有 row 组记录、没被墓碑标记、不是拉取请求的票（PR 身份未知的票按工单算）；
 *   · total 是全部；open / closed 按小写状态严格比；
 *   · 可接 = 开放 + 指派组「完整且为空」+ 没有未关闭（或状态未知）的阻塞者；
 *   · 阻塞 = 开放 + 至少一个阻塞者不是已关闭（目标不存在也算阻塞）；
 *   · 已认领 = 开放 + 至少一个指派人。
 */
function countIndependently(dbPath: string): Six {
  const db = new DatabaseSync(dbPath)
  try {
    const rows = db.prepare(`
      SELECT i.issue_id AS id, LOWER(COALESCE(i.state, '')) AS state,
             COALESCE(i.is_pull_request, 0) AS pr
        FROM issue i
        JOIN issue_group g ON g.issue_id = i.issue_id AND g.group_name = 'row'
        LEFT JOIN issue_tombstone t ON t.issue_id = i.issue_id
       WHERE t.issue_id IS NULL AND COALESCE(i.is_pull_request, 0) = 0
    `).all() as Array<{ id: number, state: string, pr: number }>
    const out: Six = { total: 0, open: 0, closed: 0, takeable: 0, blocked: 0, claimed: 0 }
    for (const row of rows) {
      out.total += 1
      const open = row.state === 'open'
      const closed = row.state === 'closed'
      if (open) out.open += 1
      if (closed) out.closed += 1
      const assignees = db.prepare('SELECT COUNT(*) AS n FROM issue_assignee WHERE issue_id = ?').get(row.id) as { n: number }
      const assigneeGroup = db.prepare("SELECT completeness FROM issue_group WHERE issue_id = ? AND group_name = 'assignees'").get(row.id) as { completeness: string } | undefined
      const claimed = Number(assignees.n) > 0
      const assigneesKnownEmpty = !!assigneeGroup && assigneeGroup.completeness === 'complete' && Number(assignees.n) === 0
      const blockers = db.prepare(`
        SELECT LOWER(COALESCE(t.state, '')) AS state
          FROM issue_edge e JOIN issue t ON t.issue_id = e.object_id
         WHERE e.subject_id = ? AND e.kind = 'blocks'
      `).all(row.id) as Array<{ state: string }>
      const blocked = blockers.some((b) => b.state !== 'closed')
      if (!open) continue
      if (claimed) out.claimed += 1
      if (blocked) out.blocked += 1
      if (!claimed && assigneesKnownEmpty && !blocked) out.takeable += 1
    }
    return out
  } finally {
    db.close()
  }
}

function sameSix(a: any, b: any): boolean {
  return !!a && !!b && a.total === b.total && a.open === b.open && a.closed === b.closed
    && a.takeable === b.takeable && a.blocked === b.blocked && a.claimed === b.claimed
}

/** 一条契约票（索引扫描的假后端交回的原样行）。 */
function issueRowOf(key: string, state: string, updatedAt: string): any {
  return {
    key: key, effortId: '', type: 'issue', title: '票 ' + key, state: state, body: '', url: '',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: updatedAt, closedAt: null, parentKey: null,
    labels: [], assignees: [], blockedBy: [], isPullRequest: false,
  }
}

/** 假索引会话：listPage 按第几页给数据（nextCursor 为 null 就翻到底）。 */
function indexSessionOf(pageOf: (n: number) => { items: any[], nextCursor: string | null }): any {
  let n = 0
  return {
    listPage: async function (): Promise<any> {
      n += 1
      const page = pageOf(n)
      return { ok: true, data: { items: page.items, nextCursor: page.nextCursor, total: page.items.length } }
    },
  }
}

/** 造一份真取数入口：会话是假的、库是真的；索引扫描与写库都走生产那两件。 */
function makeIssueList(cwd: string, session: any): any {
  const repo = { backend: 'github', refId: 'acme/widgets', name: 'acme/widgets', url: '' }
  return createIssueList({
    getRepoKey: async function (): Promise<any> { return { owner: 'acme', name: 'widgets' } },
    issueIndexFromSnapshot: function (): any { return {} },
    issueIndexChanged: function (): boolean { return true },
    rememberIssueIndex: function (): void {},
    openSession: async function (): Promise<any> {
      return {
        ok: true, backendId: 'github', repoRef: repo,
        call: async function (fn: any): Promise<any> { return fn(session, {}) },
      }
    },
    onIssueRows: async function (c: string, ref: any, rows: any[]): Promise<any> {
      return snapshotLibrary.recordIssueRows({ workspaceRoot: c, backend: String(ref.backend), repoIdentity: String(ref.refId), rows: rows })
    },
    getSnapshotLibrary: async function (): Promise<any> { return snapshotLibrary },
    logCtx: null,
    noteSnapshot: function (): void {},
  })
}

async function main(): Promise<void> {
  console.log('统计改由库计算门禁（#1887）')

  // ==========================================================================
  // A 六个数字与直接查库逐项相等
  // ==========================================================================
  const aRoot = makeWorkspace('verify-1887-a-')
  try {
    const dbPath = path.join(aRoot, 'snapshot.sqlite')
    const opened: any = openWorkspaceSnapshot({ ...IDENTITY, workspaceRoot: aRoot, dbPath, leaseOwner: 'gate-1887-a' })
    const h = opened.handle
    // 票池：每条分支都有一张票代表。
    const writes: IssueWrite[] = [
      ticket('1', 'open', { assignees: [] }),                       // 可接
      ticket('2', 'open', { assignees: ['alice'] }),                // 已认领
      ticket('3', 'open', { assignees: [], blockedBy: ['1'] }),     // 被开放票阻塞
      ticket('4', 'open', { assignees: [], blockedBy: ['5'] }),     // 被已关闭票阻塞 → 可接
      ticket('5', 'closed'),                                        // 已关闭
      ticket('6', 'closed', { assignees: ['bob'] }),                // 已关闭且有人认领（不算在办认领）
      ticket('7', 'open'),                                          // 没有指派组 → 不知道有没有人认领，不算可接
      ticket('8', 'open', { assignees: [], assigneesCompleteness: 'truncated' }), // 只取到一部分，不能当「确认没人」
      ticket('9', 'open', { assignees: [], blockedBy: ['99'] }),    // 阻塞目标不在库里 → 未知状态 → 阻塞
      ticket('10', 'open', { assignees: [], isPullRequest: true }), // 拉取请求：六个数字都不算
      ticket('11', 'open', { assignees: [] }),                      // 墓碑：不算
      ticket('12', 'open', { assignees: [] }),                       // PR 身份未知：按工单算（与界面 ticketRowsOf 同口径）
    ]
    const ing = h.ingest({ startMergeVersion: h.getMergeVersion(), writes })
    check(ing.committed === true, 'A1 代表性票池写进真 SQLite（12 张）', ing)
    const missing = h.markMissing([{ effortId: '', key: '11' }], h.getMergeVersion())
    check(missing.committed === true && missing.marked === 1, 'A2 第 11 张写墓碑（确认不存在）', missing)

    const got = h.readCounts()
    const expected = countIndependently(dbPath)
    check(sameSix(got, expected), 'A3 库的 six 个数字与另一条独立 SQL 数出来逐项相等', { got, expected })
    check(got.total === 10 && got.open === 8 && got.closed === 2, 'A4 总数/开放/已关闭按状态数（含已关闭、不含 PR 与墓碑）', { total: got.total, open: got.open, closed: got.closed })
    check(got.takeable === 3 && got.blocked === 2 && got.claimed === 1, 'A5 可接/阻塞/已认领按行与边算（缺指派组与只取到一部分都不算可接）', { takeable: got.takeable, blocked: got.blocked, claimed: got.claimed })
    check(got.completeness === 'known', 'A6 没写过完整枚举标记 → 完整度是「已知」', got.completeness)

    const marked = h.writeSyncBookkeeping({ fullEnumerationMs: 1761900000000 })
    check(marked.committed === true, 'A7 写一次「整仓完整枚举」时刻', marked)
    check(h.readCounts().completeness === 'complete', 'A8 写过完整枚举标记 → 完整度是「完整」')
    h.close()
    const reopened: any = openWorkspaceSnapshot({ ...IDENTITY, workspaceRoot: aRoot, dbPath, leaseOwner: 'gate-1887-a2' })
    check(reopened.handle.readCounts().completeness === 'complete', 'A9 关库重开后完整度仍在（标记住在库里）')
    check(sameSix(reopened.handle.readCounts(), expected), 'A10 关库重开后六个数字与独立查询仍逐项相等', reopened.handle.readCounts())
    reopened.handle.close()
  } finally {
    try { rmSync(aRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ }
  }

  // ==========================================================================
  // B 改一行状态之后（不等任何校准），数字立刻反映新值
  // ==========================================================================
  const bRoot = makeWorkspace('verify-1887-b-')
  try {
    const dbPath = path.join(bRoot, 'snapshot.sqlite')
    const opened: any = openWorkspaceSnapshot({ ...IDENTITY, workspaceRoot: bRoot, dbPath, leaseOwner: 'gate-1887-b' })
    const h = opened.handle
    h.ingest({
      startMergeVersion: h.getMergeVersion(),
      writes: [ticket('1', 'open', { assignees: [] }), ticket('2', 'closed'), ticket('3', 'open', { assignees: ['alice'] })],
    })
    const before = h.readCounts()
    check(before.open === 2 && before.closed === 1 && before.takeable === 1 && before.claimed === 1,
      'B1 出发时 2 开 1 关，可接 1、已认领 1', before)
    // 把 1 号票关掉：不碰任何「校准」标记，也没有任何缓存要等。
    const changed = h.ingest({ startMergeVersion: h.getMergeVersion(), writes: [ticket('1', 'closed')] })
    check(changed.committed === true, 'B2 同一张票改一次状态（真库提交）', changed)
    const after = h.readCounts()
    check(after.open === 1 && after.closed === 2 && after.total === 3,
      'B3 再查一次，开放与已关闭立刻换了新值（不等待校准）', after)
    check(after.takeable === 0, 'B4 关掉的那张票也不再算可接', after)
    check(sameSix(after, countIndependently(dbPath)), 'B5 改完之后的 six 个数仍与独立查询逐项相等', { after, expected: countIndependently(dbPath) })
    h.close()
  } finally {
    try { rmSync(bRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ }
  }

  // ==========================================================================
  // C 宿主电话：一次计数请求都不发；六个数字与库一致；已关闭的票也参与统计
  // ==========================================================================
  const cRoot = makeWorkspace('verify-1887-c-')
  try {
    const repo = { backend: 'github' as const, refId: 'acme/widgets', name: 'widgets', url: 'https://github.com/acme/widgets' }
    const rows: any[] = [
      { key: '11', effortId: '', type: 'issue', title: '可接的开放票', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, assignees: [] },
      { key: '12', effortId: '', type: 'issue', title: '已认领的开放票', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, assignees: [{ login: 'alice' }] },
      { key: '13', effortId: '', type: 'issue', title: '被一张不存在的票阻塞', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, assignees: [], blockedBy: [{ key: '99', title: '' }] },
      { key: '14', effortId: '', type: 'issue', title: '已关闭的票', state: 'closed', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null },
      { key: '15', effortId: '', type: 'issue', title: '已关闭且有人认领', state: 'closed', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, assignees: [{ login: 'bob' }] },
      { key: '16', effortId: '', type: 'issue', title: '拉取请求', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, assignees: [], isPullRequest: true },
    ]
    const net = { list: 0, counts: 0 }
    const fakeBackend: any = {
      list: async () => { net.list += 1; return { ok: true, data: rows.map((row) => Object.assign({}, row)) } },
      // 后端计数故意给一组错数：如果还有人问它，这里既计数又能被断言当场抓住。
      counts: async () => { net.counts += 1; return { ok: true, data: { open: 999, closed: 999, total: 999 } } },
      listPage: async () => ({ ok: false, error: { kind: 'unsupported' } }),
      listSubIssues: async () => ({ ok: false, error: { kind: 'unsupported' } }),
      getCurrentUser: async () => ({ ok: true, data: { login: 'octo' } }),
    }
    const registry: any = { describe: () => repo, modules: () => [], get: () => fakeBackend }
    let adopted: any = null
    const phone: any = createSessionSnapshot({
      canonicalKey: async (value: unknown) => String(value),
      selectEarly: async () => ({ backendId: 'github', rev: 1 }),
      isComposerSelection: () => false,
      getTrackerRegistry: async () => registry,
      getPlatform: async () => ({}),
      ctx: { get: () => null },
      upcaseSnapStates: (snap: any) => {
        const up = (row: any) => { if (row && row.state) row.state = String(row.state).toUpperCase(); return row }
        ;(snap.maps || []).forEach((m: any) => { up(m); (m.tickets || []).forEach(up) })
        ;(snap.issues || []).forEach(up)
        return snap
      },
      computeLevels: () => ({ byNumber: {}, byKey: {} }),
      groupTickets: (tickets: any[]) => ({ total: tickets.length, open: tickets.filter((x) => x.state !== 'CLOSED').length, closed: tickets.filter((x) => x.state === 'CLOSED').length, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
      getRepoRoot: async () => cRoot,
      getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
      adoptSnapshot: (snap: unknown) => { adopted = snap; return snap },
      detectionExec: () => { throw new Error('这一路不该执行命令') },
      getGhPath: () => null,
      getGhLastError: () => null,
      errText: (e: any) => String((e && e.message) || e),
      getSnapshotLibrary: async () => snapshotLibrary,
      openSession: async () => ({ ok: true, backendId: 'github', repoRef: repo, call: async (fn: any) => fn(fakeBackend, { cwd: '' }) }),
      logCtx: null,
      DEFAULT_CWD: cRoot,
    } as any)
    const key = { workspaceRoot: cRoot, backend: 'github', repoIdentity: repo.refId }

    const emptyCounts = await readSnapshotCounts(key)
    check(!!emptyCounts && emptyCounts.total === 0 && emptyCounts.completeness === 'known',
      'C1 出发时库是空的：计数是 0 + 「已知」（不拿上次的数冒充，也不补假数字）', emptyCounts)
    const first: any = await phone.handleSnapshot({ cwd: cRoot, backendId: 'github' })
    check(first && first.ok === true, 'C2 空库首屏走在线重建并成功', first)
    const snap = adopted || first
    const counts = snap && snap.deck && snap.deck.counts
    check(net.counts === 0, 'C3 这一趟后端一次计数请求都没发（计数电话 0 次）', net)
    check(!!counts && counts.open !== 999 && counts.total !== 999, 'C4 回包里的数字不是后端 counts 那一组（被忽略的错数没有混进来）', counts)
    const expected = countIndependently(path.join(cRoot, '.dsh-mattskillsdeck-cache', 'snapshot', 'github.sqlite'))
    check(sameSix(counts, expected), 'C5 回包里的 six 个数与直接查库逐项相等', { counts, expected })
    check(!!counts && counts.closed === 2 && counts.total === 5,
      'C6 已关闭的票也参与统计（首屏不画的 closed 两票进了 total/open/closed）', counts)
    check(!!counts && counts.completeness === 'known', 'C7 库还没经历过完整枚举 → 完整度是「已知」', counts && counts.completeness)

    const second: any = await phone.handleSnapshot({ cwd: cRoot, backendId: 'github' })
    const snap2 = adopted || second
    check(second && second.ok === true && !!(snap2 && snap2.fromCache === true), 'C8 第二次首屏从库回放（不再取数）', snap2 && snap2.fromCache)
    check(net.counts === 0, 'C9 回放这一趟计数电话仍是 0 次', net)
    check(second && second.deck && sameSix(second.deck.counts, expected), 'C10 回放回包的 six 个数与直接查库逐项相等', second && second.deck && second.deck.counts)

    // 在库里标一次「整仓完整枚举」：回放的下一次首屏应当说「完整」。
    const marked = await writeSyncState(key, { fullEnumerationMs: 1761900000000 })
    check(!!marked && marked.committed === true, 'C11 在库里标一次整仓完整枚举', marked)
    const third: any = await phone.handleSnapshot({ cwd: cRoot, backendId: 'github' })
    check(third && third.deck && third.deck.counts && third.deck.counts.completeness === 'complete',
      'C12 标完之后回放说「完整」，六个数不变', third && third.deck && third.deck.counts)
    check(sameSix(third.deck.counts, expected), 'C13 「完整」那一份的 six 个数仍与库一致', third && third.deck && third.deck.counts)
    check(net.counts === 0, 'C14 从头到尾计数电话都是 0 次', net)
  } finally {
    try { closeSnapshotLibraries() } catch { /* 句柄已经关了 */ }
    try { rmSync(cRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ }
  }

  // ==========================================================================
  // D 界面：counts 切片读回六个数 + 完整度；库没取全时显示「已知 N 张（未取全）」
  // ==========================================================================
  {
    const withCounts = (counts: any) => ({ snapshot: { deck: { counts: counts }, issues: [] } })
    const full = withCounts({ total: 12, open: 8, closed: 4, takeable: 3, blocked: 2, claimed: 1, completeness: 'complete' })
    const partial = withCounts({ total: 5, open: 3, closed: 2, takeable: 1, blocked: 1, claimed: 1, completeness: 'known' })
    const cFull: any = deckCountsOf(full, false)
    check(!!cFull && cFull.total === 12 && cFull.open === 8 && cFull.closed === 4 && cFull.takeable === 3 && cFull.blocked === 2 && cFull.claimed === 1,
      'D1 counts 切片读回六个数字（与库那一份逐项相同）', cFull)
    check(!!cFull && cFull.complete === true, 'D2 完整枚举过 → 切片标 complete', cFull && cFull.complete)
    const cPartial: any = deckCountsOf(partial, false)
    check(!!cPartial && cPartial.complete === false && cPartial.completeness === 'known', 'D3 库没取全 → 切片标 known / complete=false', cPartial)
    const kFull: any = kpiCountsOf(full, false, { open: 1, occupied: 0, closed: 1 })
    check(!!kFull && kFull.takeable === 3 && kFull.blocked === 2 && kFull.closed === 4 && kFull.complete === true,
      'D4 KPI 三枚数字直接取库的可接/阻塞/已关闭（不再用后端 open 减占用）', kFull)
    const kPartial: any = kpiCountsOf(partial, false, { open: 1, occupied: 0, closed: 1 })
    check(!!kPartial && kPartial.total === 5 && kPartial.complete === false, 'D5 库没取全时 KPI 仍给数字，但标 complete=false（界面据此说「已知」）', kPartial)
    check(deckCountsOf(withCounts({ total: 1 }), false) === null, 'D6 六个数字缺一格 → 整份不采信（不拿剩下的拼一个数）')
    check(deckCountsOf({ snapshot: { deck: { counts: { total: 1, open: 1, closed: 0, takeable: 1, blocked: 0, claimed: 0, completeness: 'maybe' } } } }, false) === null,
      'D7 完整度认不出来 → 整份不采信')
    check(deckCountsOf(full, true) === null, 'D8 带着筛选时不拿全仓数字冒充筛过的数字（老口径不变）')

    // 这两条看原文：文案键就写在字符串里，去掉字符串就没得看了。
    const listTab = sourceOf('src/client/views/ListTab.ts')
    check(listTab.indexOf("tr('list.countsKnownPartial'") >= 0, 'D9 列表页在库没取全时画「已知 N 张（未取全）」那句')
    check(listTab.indexOf('countsPendingTitle') < 0, 'D10 列表页不再引用「待校准」文案')
    const flow = sourceOf('config/copy/flow.yaml')
    check(flow.indexOf("list.countsKnownPartial: 已知 {n} 张（未取全）") >= 0 && flow.indexOf('list.countsKnownPartial: Known {n} (not fully fetched)') >= 0,
      'D11 「已知 N 张（未取全）」中英两份都在词表里')
    check(flow.indexOf('list.countsPendingTitle') < 0, 'D12 词表里不再有「待校准」这一条（中英一起删掉）')
    const srcFiles = ['src/client/views/ListTab.ts', 'src/client/kernel/store-derived.ts', 'src/tracker/deck-counts.ts', 'src/host/tracker/snapshot.ts']
    const pendingHits = srcFiles.filter((rel) => codeOnly(sourceOf(rel)).indexOf('countsPending') >= 0)
    check(pendingHits.length === 0, 'D13 源码里不再有 countsPending 标记（待校准这一档彻底退场）', pendingHits)
  }

  // ==========================================================================
  // E 改一行之后界面立刻换数字：变化集回包带同一时刻的六个数字
  // ==========================================================================
  {
    // E1 宿主变化集回包：带 changed / missing 的同时带 counts（同一个库、同一刻）。
    const libCounts = { total: 7, open: 4, closed: 3, takeable: 2, blocked: 1, claimed: 1, completeness: 'known' }
    const channels: any = createSnapshotReadChannels({
      canonicalKey: (value: unknown) => String(value),
      selectEarly: () => ({ backendId: 'github' }),
      getTrackerRegistry: () => ({ describe: () => ({ refId: 'acme/widgets' }) }),
      getRepoKey: () => ({ owner: 'acme', name: 'widgets' }),
      getSnapshotLibrary: () => ({
        readLibraryVersion: () => 12,
        readLibraryChangeSet: () => ({ mergeVersion: 12, full: false, reason: null, changes: [], missing: [] }),
        readSnapshotCounts: () => Object.assign({}, libCounts),
      }),
      logEvent: null,
    } as any)
    const changedReply: any = await channels.handleSnapshotChanges({ cwd: 'D:/ws/e', sinceVersion: 11, sinceMs: 1 })
    check(!!changedReply && changedReply.full === false && changedReply.version === 12, 'E1 变化集回包仍是「版本 + 变化行 + 墓碑行」', changedReply)
    check(!!changedReply && !!changedReply.counts && changedReply.counts.total === 7 && changedReply.counts.completeness === 'known',
      'E2 变化集回包带同一时刻的六个数字 + 完整度', changedReply && changedReply.counts)

    // E3 客户端合并：换行的同一次合并里把数字也换掉（不再等下一次整份快照）。
    const before: any = {
      ok: true, maps: [], thinTickets: [],
      issues: [{ key: '1', number: 1, effortId: '', title: '票 1', state: 'OPEN' }],
      deck: { counts: { total: 1, open: 1, closed: 0, takeable: 1, blocked: 0, claimed: 0, completeness: 'known' } },
    }
    const merged: any = applySnapshotChangeSet(before, [{ key: '1', effortId: '', row: { title: '票 1', state: 'closed' }, groups: { row: {} } }], [], {
      idOf: (row: any) => String((row && row.effortId) || '') + '#' + String((row && row.key) || ''),
      counts: { total: 1, open: 0, closed: 1, takeable: 0, blocked: 0, claimed: 0, completeness: 'known' },
      rowFieldsOf: snapshotRowFieldsOf,
    })
    check(!!merged && merged.snapshot.issues[0].state === 'CLOSED', 'E3 变化集把那一行换成新状态', merged && merged.snapshot.issues)
    check(!!merged && merged.snapshot.deck.counts.open === 0 && merged.snapshot.deck.counts.closed === 1,
      'E4 同一次合并把六个数字也换成新值（改一行之后数字立刻跟着变）', merged && merged.snapshot.deck)
    check(!!merged && merged.redrawn.length === 1, 'E5 只重画变化的那一行（其余行不动）', merged && merged.redrawn)
  }

  // ==========================================================================
  // F 预算门禁：一条 SQL 算 six 个数；1000 张票上取中位数 ≤ 5 毫秒
  // ==========================================================================
  const fRoot = makeWorkspace('verify-1887-f-')
  try {
    const dbPath = path.join(fRoot, 'snapshot.sqlite')
    const opened: any = openWorkspaceSnapshot({ ...IDENTITY, workspaceRoot: fRoot, dbPath, leaseOwner: 'gate-1887-f' })
    const h = opened.handle
    const many: IssueWrite[] = []
    for (let i = 0; i < 1000; i += 1) {
      const key = String(2000 + i)
      const open = i % 5 !== 0
      const extra: any = { title: '合成票 ' + i }
      if (i % 3 === 0 && open) extra.assignees = ['user-' + (i % 7)]
      else extra.assignees = []
      if (i % 11 === 0) extra.blockedBy = [String(2000 + ((i + 1) % 1000))]
      many.push(ticket(key, open ? 'open' : 'closed', extra))
    }
    const seed = h.ingest({ startMergeVersion: h.getMergeVersion(), writes: many })
    check(seed.committed === true, 'F1 合成库写入 1000 张票（真 SQLite、一个事务）', seed)

    // 一条 SQL：把 db.prepare 包一层计数，看 six 个数到底用了几条语句。
    const raw = new DatabaseSync(dbPath)
    try {
      const seen: string[] = []
      const counted = {
        prepare(sql: string): any { seen.push(sql); return raw.prepare(sql) },
      } as any
      const counts = readCountsProjection(counted)
      check(seen.length === 2, 'F2 六个数字只发一条语句（另一条是读库级完整度标记；共 2 条）', seen.length)
      const six = seen[0] || ''
      check(['AS total', 'AS open', 'AS closed', 'AS takeable', 'AS blocked', 'AS claimed'].every((alias) => six.indexOf(alias) >= 0),
        'F3 那一条语句同时算出六个数字（六个别名都在同一句里）', six.slice(0, 200))
      check(counts.total === 1000, 'F4 合成库上 six 个数照常算出来', counts)

      // 中位数：先热身两次，再取 7 次的第 4 小。单次最快值会被缓存与调度碰巧抬高或压低，
      // 中位数对这台机器上跑门禁时的抖动最不敏感。
      readCountsProjection(raw)
      readCountsProjection(raw)
      const samples: number[] = []
      for (let i = 0; i < 7; i += 1) {
        const t0 = performance.now()
        readCountsProjection(raw)
        samples.push(performance.now() - t0)
      }
      samples.sort((a, b) => a - b)
      const median = samples[3]
      check(median <= COUNTS_BUDGET_MS, 'F5 1000 张票上 six 个数 + 完整度查询中位数 ' + (Math.round(median * 100) / 100) + ' 毫秒 ≤ ' + COUNTS_BUDGET_MS + ' 毫秒', { median, samples })
    } finally {
      raw.close()
    }
    h.close()
  } finally {
    try { rmSync(fRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ }
  }
  // ==========================================================================
  // G 完整枚举标记：只有「完整枚举 + 没被截断 + 行真的写进库」被采用之后才写
  // ==========================================================================
  {
    const KEY = { backend: 'github', repoIdentity: 'acme/widgets' }

    // G1–G8：一次完整的整仓枚举 → 采用之后变「完整」，关库重开仍在。
    const g1Root = makeWorkspace('verify-1887-g1-')
    try {
      closeSnapshotLibraries()
      const nowIso = new Date().toISOString()
      const list = makeIssueList(g1Root, indexSessionOf(function (): any {
        return { items: [issueRowOf('1', 'open', nowIso), issueRowOf('2', 'closed', nowIso)], nextCursor: null }
      }))
      const scan: any = await list.fetchIssueIndexWindowed(g1Root, { backendId: 'github' })
      check(!!scan && scan.ok === true && scan.full === true && scan.windowed === false && scan.persisted === true,
        'G1 第一次没有水印 → 整仓完整枚举（full 真、windowed 假、行写进库）', scan)
      check(!!scan && scan.repoIdentity === 'acme/widgets' && scan.backendId === 'github',
        'G2 扫描回包带着库身份（完整枚举标记要靠它开对库）', scan && { repoIdentity: scan.repoIdentity, backendId: scan.backendId })
      const beforeMark = await readSnapshotCounts({ workspaceRoot: g1Root, ...KEY })
      check(!!beforeMark && beforeMark.completeness === 'known',
        'G3 只取数、还没采用 → 完整度仍是「已知」（取数完成不等于采用）', beforeMark && beforeMark.completeness)
      const committed: any = await list.commitIssueIndex(g1Root, scan.nextWatermarkMs, scan.index, {
        fullEnumeration: scan.full, backendId: scan.backendId, repoIdentity: scan.repoIdentity,
      })
      check(!!committed && committed.ok === true, 'G4 采用这一趟（推进水印与基线）', committed)
      const marked = await readSnapshotCounts({ workspaceRoot: g1Root, ...KEY })
      check(!!marked && marked.completeness === 'complete', 'G5 完整枚举被采用之后完整度变「完整」', marked && marked.completeness)
      check(!!marked && marked.total === 2 && marked.open === 1 && marked.closed === 1,
        'G6 同一份库上的六个数字（2 张票、1 开 1 关）', marked)
      const st = { snapshot: { deck: { counts: marked } } }
      const kpi: any = kpiCountsOf(st, false, { open: 0, occupied: 0, closed: 0 })
      check(!!kpi && kpi.complete === true, 'G7 措辞条件：完整枚举之后不再走「已知 N 张（未取全）」那一支', kpi)
      closeSnapshotLibraries()
      const reopened = await readSnapshotCounts({ workspaceRoot: g1Root, ...KEY })
      check(!!reopened && reopened.completeness === 'complete', 'G8 关库重开之后完整度仍然是「完整」（它住在库里）', reopened && reopened.completeness)
    } finally {
      try { closeSnapshotLibraries() } catch { /* 句柄已经关了 */ }
      try { rmSync(g1Root, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ }
    }

    // G9–G12：翻页被预算拦住（索引不完整）→ 这一趟到不了 commit，完整度仍是「已知」。
    const g2Root = makeWorkspace('verify-1887-g2-')
    try {
      closeSnapshotLibraries()
      const nowIso = new Date().toISOString()
      let pageNo = 0
      const list = makeIssueList(g2Root, indexSessionOf(function (): any {
        pageNo += 1
        return { items: [issueRowOf('1', 'open', nowIso)], nextCursor: 'cursor-' + pageNo }
      }))
      const scan: any = await list.fetchIssueIndexWindowed(g2Root, { backendId: 'github' })
      check(!!scan && scan.ok === false && !!scan.error && String(scan.error.kind) === 'truncated',
        'G9 翻页被本轮请求预算拦住 → 如实回「截断」，不拿不完整的索引当完整枚举', scan)
      check(!scan || scan.full !== true, 'G10 截断的那一趟没有「完整枚举」这一档（调用方不会拿它去写标记）', scan && scan.full)
      const afterTrunc = await readSnapshotCounts({ workspaceRoot: g2Root, ...KEY })
      check(!!afterTrunc && afterTrunc.completeness === 'known',
        'G11 被截断的那一趟之后完整度仍是「已知」', afterTrunc && afterTrunc.completeness)
      const probeSrc = codeOnly(sourceOf('src/refresh/rooms/host/probe-handler.ts'))
      check(probeSrc.indexOf('fullEnumeration: remote.full === true && remote.persisted !== false') >= 0,
        'G12 探针只在「完整枚举且这一趟的行真的写进库」时才把标记交给推进口（结构性判据）')
    } finally {
      try { closeSnapshotLibraries() } catch { /* 句柄已经关了 */ }
      try { rmSync(g2Root, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ }
    }

    // G13–G16：有可用水印 → 这一趟是窗口扫描；即使被采用也不写「完整枚举」。
    const g3Root = makeWorkspace('verify-1887-g3-')
    try {
      closeSnapshotLibraries()
      const nowIso = new Date().toISOString()
      const list = makeIssueList(g3Root, indexSessionOf(function (): any {
        return { items: [issueRowOf('1', 'open', nowIso)], nextCursor: null }
      }))
      const seeded: any = await list.commitIssueIndex(g3Root, Date.now(), {})
      check(!!seeded && seeded.ok === true, 'G13 先立一个可用水印（只推状态，不写完整枚举时刻）', seeded)
      const scan: any = await list.fetchIssueIndexWindowed(g3Root, { backendId: 'github' })
      check(!!scan && scan.ok === true && scan.full === false && scan.windowed === true,
        'G14 有水印时这一趟是窗口扫描（full 假、windowed 真）', scan && { full: scan.full, windowed: scan.windowed })
      const committed: any = await list.commitIssueIndex(g3Root, scan.nextWatermarkMs, scan.index, {
        fullEnumeration: scan.full, backendId: scan.backendId, repoIdentity: scan.repoIdentity,
      })
      check(!!committed && committed.ok === true, 'G15 窗口扫描被采用（推进水印）', committed)
      const afterWindow = await readSnapshotCounts({ workspaceRoot: g3Root, ...KEY })
      check(!!afterWindow && afterWindow.completeness === 'known',
        'G16 窗口扫描被采用也不写完整枚举时刻 → 完整度仍是「已知」', afterWindow && afterWindow.completeness)
    } finally {
      try { closeSnapshotLibraries() } catch { /* 句柄已经关了 */ }
      try { rmSync(g3Root, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ }
    }
  }

}

await main()

console.log('')
if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
else console.log('OK：' + total + ' 条断言全部通过')
printGateResult(GATE, total, failed)
process.exit(failed ? 1 : 0)
