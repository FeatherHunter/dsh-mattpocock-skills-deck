/**
 * tests/verify-1869-refresh-write.ts —— 手动刷新（wf.refresh）必须把这一轮的行整批写进快照库（#1869 的 1869-02）
 *
 * 治的是什么：真机补验发现 wf.refresh 从来只在内存里更新快照，不写快照库。表现是刷新回 ok、
 * 界面也变了，但重建窗口后库里仍是旧标题。这一扇门禁从宿主电话路的入口打进去，用真 SQLite 与
 * 真临时工作区，要求一趟刷新至少做对三件事：
 *   一、调用 recordIssueRows 恰好一次，并带 atomic:true（整轮一个事务，不是 200 条一批）；
 *   二、库里的合并版本只前进一格（一次事务只提交一次），回放出来的是这一轮的新标题；
 *   三、写库失败时整趟刷新失败，不能只更新内存、留一份重启就消失的数据。
 *
 * 为什么从 createSessionRefresh 进：这条电话路是「刷新按钮」唯一的宿主入口；只测 recordIssueRows
 * 测不到「刷新根本没接线」这个故障。上一版四条真机演练就是因为只看了在线数据、没看库，才把
 * 1869-02 判成通过。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1869-refresh-write.ts
 */
// 门禁归属: src/refresh/rooms/host/session-refresh-schedule.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { printGateResult } from './lib/gate-result.ts'
import { createSessionRefresh } from '../src/refresh/rooms/host/session-refresh-schedule.ts'
import { recordIssueRows, readSnapshotReplay, closeSnapshotLibraries } from '../src/refresh/rooms/host/snapshot-library.ts'
import { createSnapshotEnvelope } from '../src/host/snapshotEnvelope.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'

const GATE = 'verify-1869-refresh-write'
const REF: RepositoryRef = { backend: 'github', refId: 'acme/widgets', name: 'widgets', url: 'https://github.com/acme/widgets' }
const quiet = { fire: () => {}, isEnabled: () => false }
let total = 0
let failed = 0

function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
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
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: input.parentKey === undefined ? null : input.parentKey,
  }
  return Object.assign(base, input)
}

/**
 * 一轮列表结果。updatedAt 可给：**换过标题的那一轮必须带一个更晚的更新时间**。
 * 为什么：#1931 起读结果的行组按「更新时间严格更新才覆盖」判，标题改了而后端更新时间没往前走，
 * 等于「两份同一时刻的数据谁后到谁赢」—— 那正是这条规则要禁止的事。真实后端改标题一定会推更新时间。
 */
function rowsWith(prefix: string, updatedAt?: string): Issue[] {
  const extra = updatedAt ? { updatedAt } : {}
  return [
    issue({ key: '100', type: 'map', title: prefix + '容器', ...extra } as any),
    issue({ key: '5', title: prefix + '子票', parentKey: '100', ...extra } as any),
  ]
}

function titlesIn(replay: any): string[] {
  const out: string[] = []
  for (const map of (replay?.snapshot?.maps || [])) {
    out.push(String(map.title || ''))
    for (const t of (map.tickets || [])) out.push(String(t.title || ''))
  }
  for (const it of (replay?.snapshot?.issues || [])) out.push(String(it.title || ''))
  return out
}

function depsFor(cwd: string, rows: Issue[], library: any) {
  const table = new Map<string, any>()
  const adopt = (snap: unknown, c: string) => { table.set(c, { ts: Date.now(), snapshot: snap, error: null, cwd: c }); return snap }
  const tracker = {
    list: async () => ({ ok: true, data: rows.map((r) => Object.assign({}, r)) }),
    counts: async () => ({ ok: false, error: { kind: 'unsupported' } }),
    getCurrentUser: async () => ({ ok: true, data: { login: 'octo' } }),
  }
  const reg = { modules: () => [], describe: () => REF, get: () => tracker }
  const base: any = {
    canonicalKey: async () => cwd,
    selectEarly: async () => ({ backendId: 'github', rev: 1 }),
    isComposerSelection: () => true,
    getTrackerRegistry: async () => reg,
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    getCache: (c: string) => table.get(String(c)) || { ts: 0, snapshot: null, error: null, cwd: String(c) },
    setCache: (v: any) => { if (v && v.cwd) table.set(String(v.cwd), v) },
    upcaseSnapStates: (s: any) => s,
    computeLevels: () => ({ byNumber: {}, byKey: {} }),
    groupTickets: (tickets: any[]) => ({
      total: tickets.length,
      open: tickets.filter((t) => String(t.state).toUpperCase() !== 'CLOSED').length,
      closed: tickets.filter((t) => String(t.state).toUpperCase() === 'CLOSED').length,
      frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {},
    }),
    getRepoRoot: async () => cwd,
    getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
    readDiskCache: async () => null,
    writeDiskCache: () => {},
    adoptSnapshot: adopt,
    detectionExec: async () => ({ ok: false }),
    resetGhCache: () => {},
    getGhPath: () => '',
    getGhLastError: () => '',
    errText: (e: any) => String((e && e.message) || e),
    logCtx: quiet,
    envelope: createSnapshotEnvelope({ getGhPath: () => '', getGhLastError: () => '', adoptSnapshot: adopt, logCtx: quiet }),
  }
  base.getSnapshotLibrary = () => library
  return base
}

async function replayOf(cwd: string): Promise<any> {
  return await readSnapshotReplay({ workspaceRoot: cwd, backend: 'github', repoIdentity: REF.refId, repo: REF })
}

/** 找到临时工作区里的快照库文件，供「把租约借给别人」这一步直接改 meta 行。 */
function dbPathOf(root: string): string {
  const dir = path.join(root, '.dsh-mattskillsdeck-cache', 'snapshot')
  const hit = readdirSync(dir).filter((n) => n.endsWith('.sqlite'))[0]
  if (!hit) throw new Error('快照库文件不在：' + dir)
  return path.join(dir, hit)
}

async function main(): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-1869-refresh-write-'))
  try {
    mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(dir, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1869-refresh')

    // 先塞一轮旧数据：库里是「旧」，下一趟刷新交回来的是「新」。
    const seed = await recordIssueRows({ workspaceRoot: dir, backend: 'github', repoIdentity: REF.refId, rows: rowsWith('旧'), atomic: true })
    check(seed.ok === true && seed.rows === 2 && typeof seed.mergeVersion === 'number', 'A1 旧的一轮先写进库（两行、带合并版本）', seed)
    const seedVersion = Number(seed.mergeVersion)
    closeSnapshotLibraries()

    // ── A. 正常刷新：一次调用、atomic:true、版本只前进一格、回放是新标题 ───────────────────
    const calls: any[] = []
    const library = {
      recordIssueRows: async (input: any) => {
        calls.push(input)
        return await recordIssueRows(input)
      },
    }
    const good = createSessionRefresh(depsFor(dir, rowsWith('新', '2026-11-02T00:00:00Z'), library) as any)
    const reply: any = await good.handleRefresh({ cwd: dir })
    check(reply && reply.ok === true, 'A2 刷新成功', reply && reply.error)
    check(calls.length === 1, 'A3 整轮刷新只调用一次 recordIssueRows（不是 200 条一批）', calls.length)
    check(calls[0] && calls[0].atomic === true, 'A4 写入带 atomic:true（整轮一个事务）', calls[0] && calls[0].atomic)
    check(calls[0] && Array.isArray(calls[0].rows) && calls[0].rows.length === 2, 'A5 交进库的是这一轮收齐的两行', calls[0] && calls[0].rows && calls[0].rows.length)
    const replay1 = await replayOf(dir)
    check(replay1 !== null && replay1.rows === 2, 'A6 库里回放仍是两行', replay1 && replay1.rows)
    check(replay1 !== null && replay1.mergeVersion === seedVersion + 1, 'A7 合并版本只前进一格（一次事务只提交一次）', replay1 && [seedVersion, replay1.mergeVersion])
    const titles1 = titlesIn(replay1)
    check(titles1.length === 2 && titles1.every((t) => t.indexOf('新') === 0), 'A8 回放出来的是这一轮的新标题', titles1)

    // ── B. 写库失败：整趟刷新必须失败，库与版本都不动（不能只更新内存） ──────────────────────
    const failing = {
      recordIssueRows: async () => ({ ok: false, rows: 0, mergeVersion: null, reason: 'disk-full' }),
    }
    const bad = createSessionRefresh(depsFor(dir, rowsWith('更旧'), failing) as any)
    const badReply: any = await bad.handleRefresh({ cwd: dir })
    check(badReply && badReply.ok === false, 'B1 写库失败时刷新如实失败', badReply && badReply.ok)
    const badText = String((badReply && badReply.error) || '')
    check(badText.indexOf('没写进本地快照库') >= 0 && badText.indexOf('disk-full') >= 0,
      'B2 失败原因说清是写库失败并带上库层原因（disk-full）', badText)
    const replay2 = await replayOf(dir)
    check(replay2 !== null && replay2.mergeVersion === replay1!.mergeVersion, 'B3 写库失败时合并版本不动', replay2 && replay2.mergeVersion)
    check(titlesIn(replay2).every((t) => t.indexOf('新') === 0), 'B4 写库失败时库里仍是上一轮的完整数据', titlesIn(replay2))

    // ── C. 没接库口：刷新照旧成功（可选注入的既有口径），库不动 ─────────────────────────────
    const noLib = depsFor(dir, rowsWith('再旧'), null)
    delete noLib.getSnapshotLibrary
    const legacy = createSessionRefresh(noLib as any)
    const legacyReply: any = await legacy.handleRefresh({ cwd: dir })
    check(legacyReply && legacyReply.ok === true, 'C1 没接库口时刷新仍成功（不改旧语义）', legacyReply && legacyReply.error)
    const replay3 = await replayOf(dir)
    check(replay3 !== null && replay3.mergeVersion === replay1!.mergeVersion, 'C2 没接库口时库不动', replay3 && replay3.mergeVersion)

    // ── D. 本地窗口遇到「别人的租约」：过期的清掉照常写；没过期的按升级现场拒绝本地写 ─────────
    // #1932 起本地路径不再抢租约，所以「另一个窗口拿着写权」在本地不再是只读的理由。
    // 这里守两件事：
    //   D1–D5 旧版本崩溃留下的过期租约：新代码开库时清掉它，刷新照常落库、版本前进；
    //   D6–D9 还有一个未过期的租约（旧版本窗口可能还在写）：本地写按规矩被拒（legacy-writer），
    //          但刷新仍要成功、界面仍要看到新数据，库与版本一个字节不动。
    closeSnapshotLibraries()
    const leaseDbPath = dbPathOf(dir)
    const setLease = (owner: string, expiresMs: number): void => {
      const raw = new DatabaseSync(leaseDbPath)
      raw.prepare('UPDATE meta SET lease_owner = ?, lease_heartbeat_ms = ?, lease_expires_ms = ? WHERE id = 1')
        .run(owner, Date.now(), expiresMs)
      raw.close()
    }
    const leaseOwnerOf = (): string | null => {
      const raw = new DatabaseSync(leaseDbPath)
      try {
        const row = raw.prepare('SELECT lease_owner FROM meta WHERE id = 1').get() as any
        return row && row.lease_owner != null ? String(row.lease_owner) : null
      } finally {
        raw.close()
      }
    }
    // 旧代码留下的写者标识形如 refresh-<进程号>-<序号>；过期时间已经过去 = 那个窗口早就没了。
    setLease('refresh-9999-1', Date.now() - 60000)
    const takeoverCalls: any[] = []
    const takeoverResults: any[] = []
    const takeoverLib = {
      recordIssueRows: async (input: any) => {
        takeoverCalls.push(input)
        const result = await recordIssueRows(input)
        takeoverResults.push(result)
        return result
      },
    }
    const takeover = createSessionRefresh(depsFor(dir, rowsWith('本地接手新', '2026-11-03T00:00:00Z'), takeoverLib) as any)
    const takeoverReply: any = await takeover.handleRefresh({ cwd: dir })
    check(takeoverReply && takeoverReply.ok === true, 'D1 过期旧租约不再挡住本地窗口：刷新成功', takeoverReply && takeoverReply.error)
    check(takeoverCalls.length === 1 && takeoverCalls[0] && takeoverCalls[0].atomic === true,
      'D2 这一趟仍是一次整批写库（atomic:true）', takeoverCalls.length)
    check(takeoverResults[0] && takeoverResults[0].ok === true && takeoverResults[0].reason === undefined,
      'D3 库层照常提交（不再是 readonly）', takeoverResults[0])
    const replay4 = await replayOf(dir)
    check(replay4 !== null && replay4.mergeVersion === replay1!.mergeVersion + 1,
      'D4 本地窗口写完合并版本前进一格', replay4 && [replay1!.mergeVersion, replay4.mergeVersion])
    check(titlesIn(replay4).every((t) => t.indexOf('本地接手新') === 0), 'D5 库里换成了这一轮的新标题', titlesIn(replay4))
    check(leaseOwnerOf() === null, 'D6 过期租约的残留行被清掉（本窗口不需要重启就接手了）', leaseOwnerOf())

    // 未过期的旧租约：新旧混写会把库写坏，所以拒绝本地写；但刷新本身仍是成功的降级。
    closeSnapshotLibraries()
    setLease('refresh-9999-2', Date.now() + 600000)
    const legacyCalls: any[] = []
    const legacyResults: any[] = []
    const legacyLib = {
      recordIssueRows: async (input: any) => {
        legacyCalls.push(input)
        const result = await recordIssueRows(input)
        legacyResults.push(result)
        return result
      },
    }
    const legacyRefresh = createSessionRefresh(depsFor(dir, rowsWith('旧版本还在', '2026-11-04T00:00:00Z'), legacyLib) as any)
    const legacyHeldReply: any = await legacyRefresh.handleRefresh({ cwd: dir })
    check(legacyHeldReply && legacyHeldReply.ok === true, 'D7 旧版本还拿着写权时刷新仍成功（这一趟只是不落库）', legacyHeldReply && legacyHeldReply.error)
    check(legacyResults[0] && legacyResults[0].ok === false && legacyResults[0].reason === 'legacy-writer',
      'D8 库层如实回 legacy-writer（不是 readonly，也不是写失败）', legacyResults[0])
    const replay5 = await replayOf(dir)
    check(replay5 !== null && replay5.mergeVersion === replay4!.mergeVersion && titlesIn(replay5).every((t) => t.indexOf('本地接手新') === 0),
      'D9 被挡住的一趟不改库：版本不动、标题仍是上一轮的',
      replay5 && [replay4!.mergeVersion, replay5.mergeVersion, titlesIn(replay5)])
    check(leaseOwnerOf() === 'refresh-9999-2', 'D10 未过期的旧租约原样留着（那是另一个进程可能还在用的写权）', leaseOwnerOf())
  } finally {
    closeSnapshotLibraries()
    rmSync(dir, { recursive: true, force: true })
  }
  printGateResult(GATE, total, failed)
}

main().catch((e) => {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exitCode = 1
})
