/**
 * tests/verify-1899-degradation-logs.ts —— 退化可诊断与新日志事件（#1899，规格 #1885「可诊断性」）
 *
 * 守什么（票面四条验收逐条落在这里）：
 *   A 五种退化在日志里一一分辨，且都退回「整份」：
 *     A1 库没接（本地快照库门面没接上）：版本读口如实回 library-not-wired，首屏走在线重建（整份），
 *        日志里有一行 snapshot.degrade 说清原因；客户端见到这条失败退回整份快照，不再「这一拍不动作」。
 *     A2 库空（开得出来但没有行）：首屏在线重建（整份），日志 reason=library-empty。
 *     A3 库坏（文件被写坏、开库自检不过）：整库重建并在线重建（整份），日志 reason=library-corrupt，
 *        同时留一行 workspaceSnapshot.corrupt（action=rebuilt）。
 *     A4 数据太旧（客户端手上的版本太旧）：变化集回「整份」，日志 reason=age-over-limit。
 *     A5 落后太多（两个版本之间的变化超过行数上限）：变化集回「整份」，日志 reason=rows-over-limit。
 *     五个原因值两两不同；每条退化都真的交出了整份数据（不是半份、不是空界面）。
 *   B 每次快照与变化集回包都记下行数、字节数与耗时：
 *     B1 首屏回放的 snapshot.read：行数与库里的行数一致、字节数就是序列化后的字节数、带版本与投影耗时。
 *     B2 变化集的 snapshot.read：行数就是 changed+missing 的条数、字节数就是序列化后的字节数。
 *   C 只看日志能回答「这次为什么走了整份」：给这一趟的日志行（只有级别、事件名、字段），
 *     一个纯函数 whyFullOf 能唯一还原原因；五种退化各还原各的，互不串味。
 *   D 新事件按纪律登记：附录第 1 章有这两行、条数门禁的字面同步、常驻申报清单里有它们，
 *     并且运行时真的发出来的每个字段都在申报字段里（不记整个对象、不记路径原文与凭证）。
 *
 * 为什么这么测：这一票要证明的是「出了事能查」。所以五种退化各用真 SQLite 临时库 + 假后端跑一遍，
 * 从真日志回调里取事件与原因值；不断言内部调用顺序，只看「日志里能不能读出这一趟为什么退成整份」。
 * 「只看日志能回答」这一条必须写成「给定日志行能唯一还原原因」的断言——只说「有日志」不算。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1899-degradation-logs.ts
 */
// 门禁归属: src/refresh/rooms/host/snapshot-degradation.ts
// 门禁归属: src/refresh/rooms/host/snapshot-read-channels.ts
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-first-screen.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts
// 门禁归属: src/refresh/rooms/client/snapshot-version-sync.ts
// 门禁归属: src/shared/log-event-list.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { createSessionSnapshot } from '../src/refresh/rooms/host/session-snapshot-cache.ts'
import { createSnapshotReadChannels } from '../src/refresh/rooms/host/snapshot-read-channels.ts'
import {
  closeSnapshotLibraries,
  readSnapshotReplay,
  recordIssueRows,
  setSnapshotLogSink,
} from '../src/refresh/rooms/host/snapshot-library.ts'
import { SNAPSHOT_DEGRADE } from '../src/refresh/rooms/host/snapshot-degradation.ts'
import { defaultSnapshotDbPath } from '../src/workspace-snapshot/runtime/paths.ts'
import { LOG_EVENT_LIST } from '../src/shared/log-event-list.ts'
import { SNAPSHOT_CHANGES_MAX_AGE_MS, SNAPSHOT_CHANGES_MAX_ROWS } from '../src/shared/time-config/src/values.js'
import { applySnapshotChangeSet } from '../src/refresh/rooms/client/snapshot-change-merge.ts'
import { idOf } from '../src/tracker/kernel/identity-keys.ts'
import { rememberSnapshotVersion, runSnapshotVersionTick } from '../src/refresh/rooms/client/snapshot-version-sync.ts'

const GATE = 'verify-1899-degradation-logs'
const ROOT = process.cwd()
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
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

/** 一行日志：与落盘文件里读到的一致（级别、事件名、字段），不含任何实现细节。 */
interface LogRow {
  level: string
  event: string
  fields: Record<string, unknown>
}

/** 一只假日志出口：只收行，不落盘。 */
function makeSink(): any {
  const rows: LogRow[] = []
  const sink: any = {
    rows: rows,
    fire: function (level: string, event: string, fields?: unknown): void {
      rows.push({ level: level, event: event, fields: (fields || {}) as Record<string, unknown> })
    },
    isEnabled: function (): boolean { return false },
    take: function (event: string): LogRow[] { return rows.filter(function (r: LogRow): boolean { return r.event === event }) },
    clear: function (): void { rows.length = 0 },
  }
  return sink
}

/**
 * 只看日志行回答「这次为什么走了整份」。
 *
 * 判据只用日志文件里能读到的三样：级别、事件名、字段。今天这件事只由 snapshot.degrade 这一行回答，
 * 答案取这一趟最后一条（同一趟不会有两种原因；若真有两种，后面那一条才是收口）。没有这一行就是
 * 「不是退化走的整份」（强制刷新、正常首屏从库回放），回空串而不是猜一个原因。
 */
function whyFullOf(rows: LogRow[]): string {
  const degrade = rows.filter(function (r: LogRow): boolean { return r.event === 'snapshot.degrade' })
  if (!degrade.length) return ''
  const last = degrade[degrade.length - 1]
  return String((last.fields && last.fields.reason) || '')
}

/** 一行假后端的票：字段够组装器用即可，不联网。 */
function issue(key: string, title: string): Issue {
  return {
    key: key,
    effortId: '',
    type: 'issue',
    title: title,
    state: 'open',
    body: '',
    url: 'https://github.com/acme/widgets/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
  }
}

interface NetCalls { list: number; currentUser: number; openSession: number; exec: number }

/** 一套假后端：行原样交回，每个联网动作记一笔（这一票只关心「整份有没有真交出来」）。 */
function makeBackend(rows: Issue[], net: NetCalls): any {
  const track = {
    list: async function (): Promise<any> { net.list += 1; return { ok: true, data: rows.map(function (row: Issue): Issue { return Object.assign({}, row) }) } },
    counts: async function (): Promise<any> { return { ok: false, error: { kind: 'unsupported' } } },
    listPage: async function (): Promise<any> { return { ok: false, error: { kind: 'unsupported' } } },
    listSubIssues: async function (): Promise<any> { return { ok: false, error: { kind: 'unsupported' } } },
    getCurrentUser: async function (): Promise<any> { net.currentUser += 1; return { ok: true, data: { login: 'octo' } } },
  }
  return {
    registry: { describe: function (): RepositoryRef { return REPO }, modules: function (): any[] { return [] }, get: function (): any { return track } },
    openSession: async function (): Promise<any> {
      net.openSession += 1
      return { ok: true, backendId: 'github', repoRef: REPO, call: async function (fn: any): Promise<any> { return fn(track, { cwd: '' }) } }
    },
  }
}

function upcaseSnapStates(snap: any): any {
  const up = function (row: any): any { if (row && row.state) row.state = String(row.state).toUpperCase(); return row }
  ;(snap.maps || []).forEach(function (m: any): void { up(m); (m.tickets || []).forEach(up) })
  ;(snap.issues || []).forEach(up)
  return snap
}

function groupTicketsOf(tickets: any[]): any {
  return {
    total: tickets.length,
    open: tickets.filter(function (t: any): boolean { return String(t.state).toUpperCase() !== 'CLOSED' }).length,
    closed: tickets.filter(function (t: any): boolean { return String(t.state).toUpperCase() === 'CLOSED' }).length,
    frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {},
  }
}

function makeWorkspace(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix))
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: ' + prefix + '\n', 'utf8')
  return root
}

/** 一台首屏电话：库门面由 libRef.current 决定（摘掉它 = 库没接），日志走同一个 sink。 */
function makePhone(root: string, libRef: { current: any }, backend: any, net: NetCalls, adopted: { snapshot: any }, sink: any): any {
  return createSessionSnapshot({
    canonicalKey: async function (value: unknown): Promise<string> { return String(value) },
    selectEarly: async function (): Promise<any> { return { backendId: 'github', rev: 1 } },
    isComposerSelection: function (): boolean { return false },
    getTrackerRegistry: async function (): Promise<any> { return backend.registry },
    getPlatform: async function (): Promise<any> { return {} },
    ctx: { get: function (): any { return null } },
    upcaseSnapStates: upcaseSnapStates,
    computeLevels: function (): any { return { byNumber: {}, byKey: {} } },
    groupTickets: groupTicketsOf,
    getRepoRoot: async function (): Promise<string> { return root },
    getRepoKey: async function (): Promise<any> { return { owner: 'acme', name: 'widgets' } },
    adoptSnapshot: function (snap: unknown): unknown { adopted.snapshot = snap; return snap },
    detectionExec: function (): never { net.exec += 1; throw new Error('这一路不该执行命令') },
    getGhPath: function (): null { return null },
    getGhLastError: function (): null { return null },
    errText: function (e: any): string { return String((e && e.message) || e) },
    getSnapshotLibrary: async function (): Promise<any> { return libRef.current },
    openSession: backend.openSession,
    logCtx: sink,
    DEFAULT_CWD: root,
  } as any)
}

function keysOf(root: string): any {
  return { workspaceRoot: root, backend: 'github', repoIdentity: REPO.refId }
}

function makeReadChannels(root: string, libRef: { current: any }, sink: any): any {
  return createSnapshotReadChannels({
    canonicalKey: async function (value: unknown): Promise<string> { return String(value) },
    selectEarly: async function (): Promise<any> { return { backendId: 'github', rev: 1 } },
    getTrackerRegistry: function (): any { return { describe: function (): RepositoryRef { return REPO }, modules: function (): any[] { return [] }, get: function (): any { return {} } } },
    getSnapshotLibrary: function (): any { return libRef.current },
    getRepoKey: async function (): Promise<any> { return { owner: 'acme', name: 'widgets' } },
    openSession: async function (): Promise<any> { return null },
    logEvent: sink ? function (level: string, event: string, fields: any): void { sink.fire(level, event, fields) } : null,
  } as any)
}

/** 快照回包里真正交出去的行数：列表行（容器与子票都收在 issues 里）。 */
function rowsIn(reply: any): number {
  return reply && Array.isArray(reply.issues) ? reply.issues.length : 0
}

function lineWith(rows: LogRow[], event: string, field: string, value: unknown): LogRow | null {
  const hit = rows.filter(function (r: LogRow): boolean { return r.event === event && r.fields && r.fields[field] === value })
  return hit.length ? hit[hit.length - 1] : null
}

async function main(): Promise<void> {
  const roots: string[] = []
  setSnapshotLogSink(null)
  try {
    // ======================================================================
    // A1 库没接：首屏走整份，日志说清 library-not-wired
    // ======================================================================
    {
      closeSnapshotLibraries()
      const root = makeWorkspace('verify-1899-a1-'); roots.push(root)
      const sink = makeSink()
      const rows = [issue('301', '库没接也能看到的甲'), issue('302', '库没接也能看到的乙')]
      const net: NetCalls = { list: 0, currentUser: 0, openSession: 0, exec: 0 }
      const adopted = { snapshot: null as any }
      const phone = makePhone(root, { current: null }, makeBackend(rows, net), net, adopted, sink)
      const reply: any = await phone.handleSnapshot({ cwd: root, backendId: 'github' })
      const snap = adopted.snapshot || (reply && reply.snapshot) || null
      check(reply && reply.ok === true, 'A1-1 库门面没接上时首屏仍然成功（在线重建，不空白）', reply && reply.ok)
      check(rowsIn(snap) === 2, 'A1-2 交出来的是整份（两张票都在），不是半份', rowsIn(snap))
      const degrade = lineWith(sink.rows, 'snapshot.degrade', 'reason', SNAPSHOT_DEGRADE.libraryNotWired)
      check(!!degrade && degrade.fields.side === 'host' && degrade.fields.phone === 'snapshot',
        'A1-3 日志里有一行 snapshot.degrade，原因 library-not-wired、来自宿主首屏', degrade && degrade.fields)
      check(whyFullOf(sink.rows) === SNAPSHOT_DEGRADE.libraryNotWired,
        'A1-4 只看这一趟的日志行能唯一还原「库没接」', whyFullOf(sink.rows))

      const readSink = makeSink()
      const channels = makeReadChannels(root, { current: null }, readSink)
      const versionReply: any = await channels.handleSnapshotVersion({ cwd: root })
      check(versionReply && versionReply.ok === false && versionReply.reason === SNAPSHOT_DEGRADE.libraryNotWired,
        'A1-5 版本读口如实回 library-not-wired（不编一个版本号）', versionReply)
      check(versionReply && versionReply.errorKind === 'library',
        'A1-6 失败类别仍是 library（客户端据此决定退回整份）', versionReply && versionReply.errorKind)
      closeSnapshotLibraries()
    }

    // ======================================================================
    // A2 库空：开得出来但没有行 → 在线重建整份，日志 library-empty
    // ======================================================================
    {
      closeSnapshotLibraries()
      const root = makeWorkspace('verify-1899-a2-'); roots.push(root)
      const sink = makeSink()
      const libModule: any = await import('../src/refresh/rooms/host/snapshot-library.ts')
      const rows = [issue('311', '空库重建甲'), issue('312', '空库重建乙'), issue('313', '空库重建丙')]
      const net: NetCalls = { list: 0, currentUser: 0, openSession: 0, exec: 0 }
      const adopted = { snapshot: null as any }
      const phone = makePhone(root, { current: libModule }, makeBackend(rows, net), net, adopted, sink)
      const emptyReplay = await readSnapshotReplay(Object.assign({ repo: REPO }, keysOf(root)))
      check(emptyReplay === null, 'A2-1 出发时库是空的（开得出来、没有回放）', emptyReplay)
      const reply: any = await phone.handleSnapshot({ cwd: root, backendId: 'github' })
      const snap = adopted.snapshot || (reply && reply.snapshot) || null
      check(reply && reply.ok === true && rowsIn(snap) === 3, 'A2-2 库空时交出整份（三张票都在）', snap && rowsIn(snap))
      check(net.list > 0, 'A2-3 这一趟真的去后端取过一次', net.list)
      const degrade = lineWith(sink.rows, 'snapshot.degrade', 'reason', SNAPSHOT_DEGRADE.libraryEmpty)
      check(!!degrade && degrade.fields.side === 'host' && degrade.fields.phone === 'snapshot',
        'A2-4 日志里有一行 snapshot.degrade，原因 library-empty', degrade && degrade.fields)
      const replayAfter = await readSnapshotReplay(Object.assign({ repo: REPO }, keysOf(root)))
      check(replayAfter !== null && replayAfter.rows === 3, 'A2-5 整份已经写进库（下一次能直接从库出）', replayAfter && replayAfter.rows)
      check(whyFullOf(sink.rows) === SNAPSHOT_DEGRADE.libraryEmpty,
        'A2-6 只看这一趟的日志行能唯一还原「库空」', whyFullOf(sink.rows))
      closeSnapshotLibraries()
    }

    // ======================================================================
    // A3 库坏：文件被写坏 → 整库重建 + 在线重建整份，日志 library-corrupt
    // ======================================================================
    {
      closeSnapshotLibraries()
      const root = makeWorkspace('verify-1899-a3-'); roots.push(root)
      const seeded = await recordIssueRows(Object.assign({ rows: [issue('321', '写坏之前的票')], atomic: true }, keysOf(root)))
      check(seeded.ok === true, 'A3-1 先建出一个有数据的库', seeded)
      closeSnapshotLibraries()
      const dbPath = defaultSnapshotDbPath(root, 'github')
      check(existsSync(dbPath), 'A3-2 库文件在预期位置', dbPath)
      for (const suffix of ['-wal', '-shm']) {
        try { unlinkSync(dbPath + suffix) } catch (e) { /* 没有这两个旁路文件也正常 */ }
      }
      writeFileSync(dbPath, 'this is not a sqlite database\n'.repeat(8), 'utf8')

      const sink = makeSink()
      setSnapshotLogSink(function (level: string, event: string, fields: any): void { sink.fire(level, event, fields) })
      const libModule: any = await import('../src/refresh/rooms/host/snapshot-library.ts')
      const rows = [issue('331', '坏库重建甲'), issue('332', '坏库重建乙')]
      const net: NetCalls = { list: 0, currentUser: 0, openSession: 0, exec: 0 }
      const adopted = { snapshot: null as any }
      const phone = makePhone(root, { current: libModule }, makeBackend(rows, net), net, adopted, sink)
      const reply: any = await phone.handleSnapshot({ cwd: root, backendId: 'github' })
      const snap = adopted.snapshot || (reply && reply.snapshot) || null
      check(reply && reply.ok === true && rowsIn(snap) === 2, 'A3-3 库坏之后交出整份（两张票都在，不是空界面）', snap && rowsIn(snap))
      const corrupt = sink.take('workspaceSnapshot.corrupt')
      check(corrupt.length >= 1 && corrupt[corrupt.length - 1].fields.action === 'rebuilt',
        'A3-4 库这一侧留了一行 workspaceSnapshot.corrupt（action=rebuilt）', corrupt.map(function (r: LogRow): any { return r.fields }))
      // 开库诊断是库这一侧的可观察事实：它说清「本机数据被清过、整库重建过」，界面据此明说。
      const diagnostics = await libModule.readSnapshotDiagnostics(keysOf(root))
      check(diagnostics.some(function (d: any): boolean { return String(d && d.code) === 'corrupt-rebuilt' }),
        'A3-5 库这一侧的开库诊断说得清「库被清过」（corrupt-rebuilt）', diagnostics)
      const degrade = lineWith(sink.rows, 'snapshot.degrade', 'reason', SNAPSHOT_DEGRADE.libraryCorrupt)
      check(!!degrade && degrade.fields.side === 'host' && degrade.fields.phone === 'snapshot',
        'A3-6 日志里有一行 snapshot.degrade，原因 library-corrupt', degrade && degrade.fields)
      check(whyFullOf(sink.rows) === SNAPSHOT_DEGRADE.libraryCorrupt,
        'A3-7 只看这一趟的日志行能唯一还原「库坏」', whyFullOf(sink.rows))
      setSnapshotLogSink(null)
      closeSnapshotLibraries()
    }

    // ======================================================================
    // A4 数据太旧：变化集回整份，日志 age-over-limit
    // ======================================================================
    {
      closeSnapshotLibraries()
      const root = makeWorkspace('verify-1899-a4-'); roots.push(root)
      const libModule: any = await import('../src/refresh/rooms/host/snapshot-library.ts')
      const libRef = { current: libModule }
      const seeded = await recordIssueRows(Object.assign({ rows: [issue('341', '旧起点'), issue('342', '旧起点二')], atomic: true }, keysOf(root)))
      check(seeded.ok === true, 'A4-1 库里有两行，作为旧起点', seeded)
      const baseVersion: any = await libModule.readLibraryVersion(keysOf(root))
      await recordIssueRows(Object.assign({ rows: [issue('343', '后来才出现的一张')] }, keysOf(root)))
      const sink = makeSink()
      const channels = makeReadChannels(root, libRef, sink)
      const stale: any = await channels.handleSnapshotChanges({
        cwd: root,
        sinceVersion: baseVersion,
        sinceMs: Date.now() - SNAPSHOT_CHANGES_MAX_AGE_MS - 60000,
      })
      check(stale && stale.full === true && stale.reason === 'age-over-limit',
        'A4-2 落后超过时间上限时回整份（reason=age-over-limit）', stale)
      check(stale && !('changed' in stale) && !('missing' in stale),
        'A4-3 这一档不给截断的变化集（不是半份）', Object.keys(stale || {}).sort())
      const degrade = lineWith(sink.rows, 'snapshot.degrade', 'reason', SNAPSHOT_DEGRADE.ageOverLimit)
      check(!!degrade && degrade.fields.side === 'host' && degrade.fields.phone === 'changes',
        'A4-4 日志里有一行 snapshot.degrade，原因 age-over-limit、来自变化集电话', degrade && degrade.fields)
      check(whyFullOf(sink.rows) === SNAPSHOT_DEGRADE.ageOverLimit,
        'A4-5 只看这一趟的日志行能唯一还原「数据太旧」', whyFullOf(sink.rows))
      closeSnapshotLibraries()
    }

    // ======================================================================
    // A5 落后太多：变化行超过上限，回整份，日志 rows-over-limit
    // ======================================================================
    {
      closeSnapshotLibraries()
      const root = makeWorkspace('verify-1899-a5-'); roots.push(root)
      const libModule: any = await import('../src/refresh/rooms/host/snapshot-library.ts')
      const libRef = { current: libModule }
      const seeded = await recordIssueRows(Object.assign({ rows: [issue('351', '基线')], atomic: true }, keysOf(root)))
      check(seeded.ok === true, 'A5-1 先写一个基线版本', seeded)
      const baseVersion: any = await libModule.readLibraryVersion(keysOf(root))
      const many: Issue[] = []
      for (let i = 0; i < SNAPSHOT_CHANGES_MAX_ROWS + 1; i += 1) many.push(issue(String(4000 + i), '批量变化 ' + i))
      const wrote = await recordIssueRows(Object.assign({ rows: many, atomic: true }, keysOf(root)))
      check(wrote.ok === true, 'A5-2 写入超过行数上限的变化行', wrote && wrote.rows)
      const sink = makeSink()
      const channels = makeReadChannels(root, libRef, sink)
      const tooMany: any = await channels.handleSnapshotChanges({ cwd: root, sinceVersion: baseVersion, sinceMs: Date.now() })
      check(tooMany && tooMany.full === true && tooMany.reason === 'rows-over-limit',
        'A5-3 变化行超过上限时回整份（reason=rows-over-limit）', tooMany)
      check(tooMany && !('changed' in tooMany) && !('missing' in tooMany),
        'A5-4 这一档同样不给截断的变化集', Object.keys(tooMany || {}).sort())
      const degrade = lineWith(sink.rows, 'snapshot.degrade', 'reason', SNAPSHOT_DEGRADE.rowsOverLimit)
      check(!!degrade && degrade.fields.side === 'host' && degrade.fields.phone === 'changes',
        'A5-5 日志里有一行 snapshot.degrade，原因 rows-over-limit', degrade && degrade.fields)
      check(whyFullOf(sink.rows) === SNAPSHOT_DEGRADE.rowsOverLimit,
        'A5-6 只看这一趟的日志行能唯一还原「落后太多」', whyFullOf(sink.rows))
      closeSnapshotLibraries()
    }

    // ======================================================================
    // A6 五个原因值两两不同
    // ======================================================================
    {
      const five = [
        SNAPSHOT_DEGRADE.libraryNotWired,
        SNAPSHOT_DEGRADE.libraryEmpty,
        SNAPSHOT_DEGRADE.libraryCorrupt,
        SNAPSHOT_DEGRADE.ageOverLimit,
        SNAPSHOT_DEGRADE.rowsOverLimit,
      ]
      check(new Set(five).size === 5 && five.every(function (v: string): boolean { return !!v }),
        'A6-1 五种退化各有一个独立的原因值（五个值两两不同）', five)
      check(five.every(function (v: string): boolean { return typeof v === 'string' && /^library-|^age-over-limit$|^rows-over-limit$/.test(v) }),
        'A6-2 原因值是稳定的枚举写法（library-* / age-over-limit / rows-over-limit）', five)
    }

    // ======================================================================
    // B1 首屏回放的读数：行数、字节数、版本、投影耗时
    // ======================================================================
    let replayRoot = ''
    {
      closeSnapshotLibraries()
      const root = makeWorkspace('verify-1899-b1-'); roots.push(root); replayRoot = root
      const seeded = await recordIssueRows(Object.assign({ rows: [issue('361', '回放甲'), issue('362', '回放乙'), issue('363', '回放丙')], atomic: true }, keysOf(root)))
      check(seeded.ok === true, 'B1-1 库里有三行', seeded)
      const sink = makeSink()
      const libModule: any = await import('../src/refresh/rooms/host/snapshot-library.ts')
      const net: NetCalls = { list: 0, currentUser: 0, openSession: 0, exec: 0 }
      const adopted = { snapshot: null as any }
      const phone = makePhone(root, { current: libModule }, makeBackend([], net), net, adopted, sink)
      const reply: any = await phone.handleSnapshot({ cwd: root, backendId: 'github' })
      const snap = adopted.snapshot || (reply && reply.snapshot) || null
      check(reply && reply.ok === true && !!snap, 'B1-2 首屏成功', reply && reply.ok)
      check(net.list === 0, 'B1-3 这一趟从库回放（零取数）', net.list)
      const read = lineWith(sink.rows, 'snapshot.read', 'phone', 'snapshot')
      check(!!read, 'B1-4 首屏回包记了一行 snapshot.read', sink.rows.filter(function (r: LogRow): boolean { return r.event === 'snapshot.read' }))
      check(!!read && read.fields.source === 'library', 'B1-5 这一行说清数据来自库回放', read && read.fields.source)
      check(!!read && read.fields.rows === rowsIn(snap) && read.fields.rows === 3,
        'B1-6 记下的行数与回包里的行数一致（也与库里的三行一致）', read && { log: read.fields.rows, reply: rowsIn(snap) })
      const expectedBytes = Buffer.byteLength(JSON.stringify(reply), 'utf8')
      check(!!read && read.fields.bytes === expectedBytes,
        'B1-7 记下的字节数就是同一趟回包序列化后的字节数', read && { log: read.fields.bytes, expected: expectedBytes })
      check(!!read && Number.isInteger(read.fields.elapsedMs) && (read.fields.elapsedMs as number) >= 0,
        'B1-8 记下这一趟回包的耗时', read && read.fields.elapsedMs)
      const replay = await readSnapshotReplay(Object.assign({ repo: REPO }, keysOf(root)))
      check(!!read && replay !== null && read.fields.version === replay.mergeVersion,
        'B1-9 记下的版本就是库里的合并版本', read && { log: read.fields.version, lib: replay && replay.mergeVersion })
      check(!!read && Number.isInteger(read.fields.projectionMs) && (read.fields.projectionMs as number) >= 0,
        'B1-10 记下库投影的耗时（毫秒）', read && read.fields.projectionMs)
      check(!read || read.fields.reason === undefined, 'B1-11 正常回放不冒充退化（这一行没有 reason 字段）', read && read.fields.reason)
      check(whyFullOf(sink.rows) === '', 'B1-12 正常从库回放的那一趟没有退化行（「整份」的答案不会被随手给出来）', whyFullOf(sink.rows))
      closeSnapshotLibraries()
    }

    // ======================================================================
    // B2 变化集回包的读数：行数、字节数、版本、投影耗时
    // ======================================================================
    {
      const root = replayRoot
      const libModule: any = await import('../src/refresh/rooms/host/snapshot-library.ts')
      const libRef = { current: libModule }
      const baseVersion: any = await libModule.readLibraryVersion(keysOf(root))
      await recordIssueRows(Object.assign({ rows: [issue('371', '变化甲')] }, keysOf(root)))
      const sink = makeSink()
      const channels = makeReadChannels(root, libRef, sink)
      const reply: any = await channels.handleSnapshotChanges({ cwd: root, sinceVersion: baseVersion, sinceMs: Date.now() })
      check(reply && reply.full === false && reply.changed.length === 1,
        'B2-1 变化集回一行变化（不是整份）', reply && reply.changed && reply.changed.length)
      const read = lineWith(sink.rows, 'snapshot.read', 'phone', 'changes')
      check(!!read, 'B2-2 变化集回包记了一行 snapshot.read', sink.rows.filter(function (r: LogRow): boolean { return r.event === 'snapshot.read' }))
      check(!!read && read.fields.rows === reply.changed.length + reply.missing.length,
        'B2-3 记下的行数就是变化行加墓碑行的条数', read && { log: read.fields.rows, reply: reply.changed.length + reply.missing.length })
      const expectedBytes = Buffer.byteLength(JSON.stringify(reply), 'utf8')
      check(!!read && read.fields.bytes === expectedBytes,
        'B2-4 记下的字节数就是同一趟变化集回包序列化后的字节数', read && { log: read.fields.bytes, expected: expectedBytes })
      check(!!read && Number.isInteger(read.fields.elapsedMs) && (read.fields.elapsedMs as number) >= 0,
        'B2-5 记下这一趟的耗时', read && read.fields.elapsedMs)
      check(!!read && Number.isInteger(read.fields.projectionMs) && (read.fields.projectionMs as number) >= 0,
        'B2-6 记下变化集投影的耗时', read && read.fields.projectionMs)
      check(!!read && read.fields.version === reply.version, 'B2-7 记下的版本就是回包里的库版本', read && { log: read.fields.version, reply: reply.version })
      check(!!read && read.fields.full === false, 'B2-8 这一行说清这一趟不是整份', read && read.fields.full)
      closeSnapshotLibraries()
    }

    // ======================================================================
    // C 客户端：版本读数失败（库没接/库坏）必须退回整份，不再「这一拍不动作」
    // ======================================================================
    {
      const cwd = 'D:\\ws1899-degrade-client'
      rememberSnapshotVersion(cwd, 5)
      const sink = makeSink()
      let mode: 'broken' | 'recovered' = 'broken'
      let versionCalls = 0
      let snapshotCalls = 0
      let changesCalls = 0
      const scope: any = {
        host: {
          call: function (method: string): any {
            if (method === 'wf.snapshotVersion') {
              versionCalls += 1
              if (mode === 'broken') {
                return Promise.resolve({ ok: false, error: '本地快照库开不出来，读不到当前版本。', errorKind: 'library', reason: 'library-corrupt' })
              }
              return Promise.resolve({ version: 9, workspaceKey: cwd, backend: 'github' })
            }
            if (method === 'wf.snapshot') {
              snapshotCalls += 1
              return Promise.resolve({ ok: true, maps: [], issues: [{ key: '1', number: 1, title: '整份回来的甲', state: 'OPEN', labels: [], assignees: [], blockedBy: [] }], thinTickets: [] })
            }
            if (method === 'wf.snapshotChanges') { changesCalls += 1; return Promise.resolve({ ok: false, error: '不该取变化集' }) }
            return Promise.resolve({ ok: false, error: 'unexpected ' + method })
          },
        },
        wsKeyOf: function (x: any): string { return String(x || '') },
        idOf: idOf,
        emit: function (): void {},
        setCachedSnapshot: function (): void {},
        applyChanges: applySnapshotChangeSet,
        log: function (level: string, event: string, fields: any): void { sink.fire(level, event, fields) },
        isEnabled: function (): boolean { return false },
      }
      const st: any = { cwd: cwd, snapshot: { ok: true, maps: [], issues: [], thinTickets: [] }, snapMode: 'real', snapLoading: false }
      const first = await runSnapshotVersionTick(st, 'gate', scope)
      check(first === 'full', 'C1 版本读数失败（库坏）时退回整份取数，而不是「这一拍不动作」', first)
      check(snapshotCalls === 1, 'C2 这一拍真的取了一次整份快照', snapshotCalls)
      check(!st.snapshot || (Array.isArray(st.snapshot.issues) && st.snapshot.issues.length === 1),
        'C3 整份装上去了（界面不是空白、不是半份）', st.snapshot && st.snapshot.issues && st.snapshot.issues.length)
      check(changesCalls === 0, 'C4 版本读不到时不乱取变化集', changesCalls)
      const degrade = sink.take('snapshot.degrade')
      check(degrade.length === 1 && degrade[0].fields.side === 'client' && degrade[0].fields.phone === 'sync' && degrade[0].fields.reason === 'library-corrupt',
        'C5 客户端记了一行 snapshot.degrade（side=client、原因沿用宿主给的原因值）', degrade.map(function (r: LogRow): any { return r.fields }))
      check(whyFullOf(sink.rows) === SNAPSHOT_DEGRADE.libraryCorrupt,
        'C6 只看这一拍的日志行能唯一还原「库坏」', whyFullOf(sink.rows))

      const again = await runSnapshotVersionTick(st, 'gate', scope)
      check(again === 'skipped', 'C7 同一段退化里下一拍不重复取整份（不把整份当心跳）', again)
      check(snapshotCalls === 1, 'C8 连续两拍只取了一次整份', snapshotCalls)

      mode = 'recovered'
      const recovered = await runSnapshotVersionTick(st, 'gate', scope)
      check(recovered === 'full', 'C9 版本读数恢复之后重新建立基线（整份一次）', recovered)
      check(snapshotCalls === 2 && versionCalls >= 3, 'C10 恢复那一拍只多取一次整份', { snapshotCalls: snapshotCalls, versionCalls: versionCalls })
      closeSnapshotLibraries()
    }

    // ======================================================================
    // D 登记：附录第 1 章、常驻申报清单、字段白名单、条数门禁
    // ======================================================================
    {
      const booked = LOG_EVENT_LIST.events['snapshot.read']
      check(!!booked && booked.level === 'info' && booked.kind === 'resident',
        'D1 snapshot.read 进常驻申报清单（信息级、始终落盘）', booked)
      const readFields = ['phone', 'source', 'cwdHash', 'version', 'rows', 'bytes', 'elapsedMs', 'projectionMs', 'full']
      check(!!booked && readFields.every(function (f: string): boolean { return booked.fields.indexOf(f) >= 0 }) && booked.fields.length === readFields.length,
        'D2 snapshot.read 的申报字段与白名单一致（不多不少）', booked && booked.fields)
      const degradeBooked = LOG_EVENT_LIST.events['snapshot.degrade']
      const degradeFields = ['side', 'phone', 'reason', 'cwdHash', 'version']
      check(!!degradeBooked && degradeBooked.fields.join(',') === degradeFields.join(','),
        'D3 snapshot.degrade 的申报字段与白名单一致（不多不少）', degradeBooked && degradeBooked.fields)

      const appendix = readFileSync(path.join(ROOT, 'research/489-appendix.md'), 'utf8')
      check(appendix.indexOf('#154') >= 0 && appendix.indexOf('snapshot.read') >= 0 && appendix.indexOf('#155') >= 0 && appendix.indexOf('snapshot.degrade') >= 0,
        'D4 附录第 1 章记明 #154 snapshot.read 与 #155 snapshot.degrade')
      check(appendix.indexOf('常驻 81 条、按需 63 条、自监控 5 条、总数 149 条') >= 0,
        'D5 附录条数字面同步为常驻 81、按需 63、自监控 5、总数 149')
      check(appendix.indexOf('153、154、155（共 81 条') >= 0, 'D6 附录常驻编号清单接续到 155（共 81 条）')

      const fieldsGate = readFileSync(path.join(ROOT, 'tests/verify-log-fields.ts'), 'utf8')
      check(fieldsGate.indexOf("'snapshot.read'") >= 0 && fieldsGate.indexOf("'snapshot.degrade'") >= 0,
        'D7 字段白名单门禁登记了这两个事件（verify-log-fields 的 ALLOWED）')
      const countGate = readFileSync(path.join(ROOT, 'tests/verify-log-count.ts'), 'utf8')
      check(countGate.indexOf("'snapshot.read'") >= 0 && countGate.indexOf("'snapshot.degrade'") >= 0,
        'D8 计数门禁把这两个事件算进常驻清单（verify-log-count 的 RESIDENT）')

      // 运行时真的发出来的字段必须都在申报字段里：多记一个就是没登记的字段。
      const emitted: string[] = []
      const allEvents: LogRow[] = []
      // 从上面 A/B/C 的记录里收集不到跨作用域的 sink，所以这里用「本门禁已经跑过的那几种行」的并集：
      // 直接重新跑一次最省事的一条（库空首屏），把真实字段抄下来对账。
      closeSnapshotLibraries()
      const root = makeWorkspace('verify-1899-d-'); roots.push(root)
      const sink = makeSink()
      const libModule: any = await import('../src/refresh/rooms/host/snapshot-library.ts')
      const net: NetCalls = { list: 0, currentUser: 0, openSession: 0, exec: 0 }
      const adopted = { snapshot: null as any }
      const phone = makePhone(root, { current: libModule }, makeBackend([issue('381', '登记对账')], net), net, adopted, sink)
      await phone.handleSnapshot({ cwd: root, backendId: 'github' })
      const readLine = lineWith(sink.rows, 'snapshot.read', 'phone', 'snapshot')
      check(!!readLine, 'D9 登记对账这一趟真的发出了 snapshot.read', null)
      if (readLine) for (const k of Object.keys(readLine.fields)) emitted.push(k)
      const extra = emitted.filter(function (k: string): boolean { return readFields.indexOf(k) < 0 })
      check(extra.length === 0, 'D10 运行时发出的字段都在申报白名单里（不把整个对象倒进日志）', extra)
      check(readLine !== null && String(readLine.fields.cwdHash || '').length === 8,
        'D11 工作区只记 8 位短散列，不记路径原文', readLine && readLine.fields.cwdHash)
      for (const row of sink.rows) allEvents.push(row)
      check(allEvents.length > 0, 'D12 这一趟的日志行确实是空的（对账有样本）', allEvents.length)
      closeSnapshotLibraries()
    }
  } finally {
    setSnapshotLogSink(null)
    closeSnapshotLibraries()
    for (const root of roots) {
      try { rmSync(root, { recursive: true, force: true }) } catch (e) { /* 清理失败不影响结论 */ }
    }
  }

  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 退化可诊断门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e: any): void {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exit(1)
})
