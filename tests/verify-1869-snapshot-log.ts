/**
 * tests/verify-1869-snapshot-log.ts —— 快照库四族诊断事件真的发得出来（#1869）
 *
 * 守什么（票面「诊断日志能定位开库、抢租约、事务提交或丢弃、回退与重建」一条）：
 *   A. 开库：`workspaceSnapshot.open` 说得出后端、库文件原先在不在、日志模式、合并版本；工作区根与
 *      仓库身份只记 8 位短散列，不落路径与身份原文。
 *   B. 抢租约：抢到时 `workspaceSnapshot.lease` 是 acquired:true 并带写者标识的短散列。
 *   C. 事务：提交成功是 `ingest` committed:true 带票数、版本与耗时；被版本门丢弃是 committed:false
 *      + reason=stale 并带一句失败说明。
 *   D. 重建：库被写坏后重新开库，`workspaceSnapshot.corrupt` 说清哪一步发现、处置是 rebuilt；跟着那条
 *      `open` 说 reason=rebuilt。
 *   E. 没接日志口时一个事件都不发，读写照旧（与仓库「可选注入 logEvent」的既有约定一致）。
 *
 * 为什么单开一扇而不并进别的门禁：这四个事件在 #1862 建库时就写下了，但注入点一直没接上，真实运行
 * 从来不记。这扇门禁从注入点进来量，才能证明「接上了」而不是「名字还在」。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1869-snapshot-log.ts
 */
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import * as library from '../src/refresh/rooms/host/snapshot-library.ts'
import { issueWritesOf } from '../src/refresh/rooms/host/snapshot-library-adapter.ts'
import { LOG_EVENT_LIST } from '../src/shared/log-event-list.ts'

const GATE = 'verify-1869-snapshot-log'
const ROOT_KEY = 'verify-1869-root'
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

interface Row {
  event: string
  level: string
  fields: Record<string, unknown>
}

/**
 * 日志收集器：同一个 `logEvent` 既能塞进宿主注入点（`setSnapshotLogSink`），也能直接交给现场开的
 * 句柄（版本门那一段要自己造过期批次，必须拿句柄）。
 */
function collector() {
  const rows: Row[] = []
  // 每个事件名各记一个已读位置：一次 take 只推进它自己那一个事件名，别的事件不受影响。
  const readUpTo = new Map<string, number>()
  const logEvent = (level: string, event: string, fields: Record<string, unknown>): void => {
    rows.push({ event, level, fields })
  }
  return {
    logEvent,
    take(event: string): Row[] {
      const from = readUpTo.get(event) || 0
      const all = rows.filter((r) => r.event === event)
      readUpTo.set(event, all.length)
      return all.slice(from)
    },
    takeAllNames(): string[] {
      const out = rows.map((r) => r.event)
      rows.length = 0
      readUpTo.clear()
      return out
    },
    reset(): void {
      rows.length = 0
      readUpTo.clear()
    },
  }
}

function issueOf(key: string, title: string): any {
  return {
    key,
    effortId: '',
    type: 'issue',
    title,
    state: 'open',
    body: '',
    url: 'https://example.invalid/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [],
  }
}

const hashed = (value: unknown): boolean => typeof value === 'string' && /^[0-9a-f]{8}$/.test(value)

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-1869-log-'))
  try {
    mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1869\n', 'utf8')
    const sink = collector()
    library.setSnapshotLogSink(sink.logEvent)

    // ── A. 开库 + 抢租约 + 第一批写入 ────────────────────────────────────────────
    library.closeSnapshotLibraries()
    sink.reset()
    const first = await library.recordIssueRows({ workspaceRoot: root, backend: 'github', repoIdentity: ROOT_KEY, rows: [issueOf('1', '第一张票'), issueOf('2', '第二张票')] })
    check(first.ok === true && first.rows === 2, 'A1 第一批写成功（前置）', first)
    const openedA = sink.take('workspaceSnapshot.open')
    check(openedA.length === 1, 'A2 开库这一次发了一条 workspaceSnapshot.open', openedA.length)
    const openA = openedA[0] && openedA[0].fields
    check(!!openA && openA.backend === 'github', 'A3 open 说得清是哪个后端', openA && openA.backend)
    check(!!openA && openA.dbExisted === false, 'A4 open 说得清开库前文件在不在（首次为 false）', openA && openA.dbExisted)
    check(!!openA && hashed(openA.rootHash) && openA.rootHash !== root, 'A5 工作区根只记 8 位短散列，不落路径原文', openA && openA.rootHash)
    check(!!openA && hashed(openA.repoHash) && openA.repoHash !== ROOT_KEY, 'A6 仓库身份也只记短散列', openA && openA.repoHash)
    check(!!openA && (openA.journalMode === 'wal' || openA.journalMode === 'delete'), 'A7 open 带日志模式', openA && openA.journalMode)
    check(!!openA && typeof openA.mergeVersion === 'number', 'A8 open 带打开时的合并版本', openA && openA.mergeVersion)

    const leasedA = sink.take('workspaceSnapshot.lease')
    check(leasedA.length === 1 && leasedA[0].fields.acquired === true, 'A9 抢到租约发一条 lease（acquired:true）', leasedA.map((r) => r.fields))
    check(!!leasedA[0] && hashed(leasedA[0].fields.ownerHash), 'A10 写者标识只记 8 位短散列', leasedA[0] && leasedA[0].fields.ownerHash)

    const ingestA = sink.take('workspaceSnapshot.ingest')
    check(ingestA.length === 1 && ingestA[0].fields.committed === true, 'A11 提交成功发一条 ingest（committed:true）', ingestA.map((r) => r.fields))
    check(!!ingestA[0] && ingestA[0].fields.writes === 2, 'A12 ingest 说得清这一批几张票', ingestA[0] && ingestA[0].fields.writes)
    check(!!ingestA[0] && typeof ingestA[0].fields.mergeVersion === 'number' && ingestA[0].fields.mergeVersion > 0, 'A13 ingest 带提交后的合并版本', ingestA[0] && ingestA[0].fields.mergeVersion)
    check(!!ingestA[0] && typeof ingestA[0].fields.elapsedMs === 'number', 'A14 ingest 带耗时', ingestA[0] && ingestA[0].fields.elapsedMs)

    // ── B. 版本门丢弃：自己开一个句柄，拿过期的起读版本再写一批 ────────────────────
    library.closeSnapshotLibraries()
    sink.reset()
    const contract = await import('../src/workspace-snapshot/contract/index.ts')
    const opened = await contract.openWorkspaceSnapshot({
      workspaceRoot: root,
      backend: 'github',
      repoIdentity: ROOT_KEY,
      leaseOwner: 'gate-1869-stale',
      now: () => Date.now(),
      logEvent: sink.logEvent,
    })
    const handle = opened.handle
    const stale = handle.ingest({ startMergeVersion: 0, writes: issueWritesOf([issueOf('2', '不该写进去的标题')]) })
    check(stale.committed === false && stale.reason === 'stale', 'B1 起读版本落后时整批被丢弃（前置）', stale)
    const ingestB = sink.take('workspaceSnapshot.ingest')
    const discarded = ingestB.filter((r) => r.fields.committed === false && r.fields.reason === 'stale')
    check(discarded.length === 1, 'B2 被版本门丢弃的那一批发一条 ingest（committed:false + reason:stale）', ingestB.map((r) => r.fields))
    check(!!discarded[0] && discarded[0].fields.writes === 1 && typeof discarded[0].fields.startMergeVersion === 'number', 'B3 丢弃那条说得出被丢的是哪一批（几张票、起读版本）', discarded[0] && discarded[0].fields)
    handle.close()

    // ── C. 库被写坏：重建 + 告警 ─────────────────────────────────────────────────
    library.closeSnapshotLibraries()
    const dbPath = path.join(root, '.dsh-mattskillsdeck-cache', 'snapshot', 'github.sqlite')
    writeFileSync(dbPath, 'not a sqlite file at all', 'utf8')
    sink.reset()
    const afterCorrupt = await library.recordIssueRows({ workspaceRoot: root, backend: 'github', repoIdentity: ROOT_KEY, rows: [issueOf('3', '重建之后写的票')] })
    check(afterCorrupt.ok === true && afterCorrupt.rows === 1, 'C1 库坏掉之后仍然能写（整库重建后继续）', afterCorrupt)
    const corruptC = sink.take('workspaceSnapshot.corrupt')
    check(corruptC.length === 1, 'C2 损坏发一条 workspaceSnapshot.corrupt', corruptC.map((r) => r.fields))
    check(!!corruptC[0] && corruptC[0].fields.action === 'rebuilt', 'C3 corrupt 说清处置是整库重建', corruptC[0] && corruptC[0].fields.action)
    check(!!corruptC[0] && typeof corruptC[0].fields.stage === 'string' && String(corruptC[0].fields.stage).length > 0, 'C4 corrupt 说清哪一步发现的', corruptC[0] && corruptC[0].fields.stage)
    check(!!corruptC[0] && (corruptC[0].level === 'warn' || corruptC[0].level === 'error'), 'C5 corrupt 是告警或错误级', corruptC[0] && corruptC[0].level)
    // 顺序能串起来：先报损坏（带处置），再报开库。读日志的人据此就能复述「坏了 → 重建 → 开好了」。
    const namesC = sink.takeAllNames()
    check(namesC.indexOf('workspaceSnapshot.corrupt') >= 0 && namesC.indexOf('workspaceSnapshot.open') > namesC.indexOf('workspaceSnapshot.corrupt'), 'C6 事件顺序说得清「先坏、后开库」', namesC)
    const diagsC = await library.readSnapshotDiagnostics({ workspaceRoot: root, backend: 'github', repoIdentity: ROOT_KEY })
    check(Array.isArray(diagsC) && diagsC.some((d) => d.code === 'corrupt-rebuilt'), 'C7 开库诊断读得到 corrupt-rebuilt（界面据此提示「已整库重建」）', diagsC)

    // ── C2. 抢不到租约：第二个句柄退回只读，日志 reason 是稳定枚举 held ────────────
    library.closeSnapshotLibraries()
    sink.reset()
    const holder = await contract.openWorkspaceSnapshot({
      workspaceRoot: root, backend: 'github', repoIdentity: ROOT_KEY,
      leaseOwner: 'gate-1869-holder', now: () => Date.now(), logEvent: sink.logEvent,
    })
    const contender = await contract.openWorkspaceSnapshot({
      workspaceRoot: root, backend: 'github', repoIdentity: ROOT_KEY,
      leaseOwner: 'gate-1869-second', now: () => Date.now(), logEvent: sink.logEvent,
    })
    const heldRows = sink.take('workspaceSnapshot.lease').filter((r) => r.fields.acquired === false)
    check(heldRows.length === 1 && heldRows[0].fields.reason === 'held', 'C8 抢不到租约时 lease 的 reason 是 held（不是一句人话）', heldRows.map((r) => r.fields))
    check(contender.mode === 'readonly' && contender.diagnostics.some((d) => d.code === 'lease-held-readonly'), 'C9 第二个句柄退回只读并带 lease-held-readonly 诊断', { mode: contender.mode, diagnostics: contender.diagnostics })
    contender.handle.close()
    holder.handle.close()

    // ── D. 没接日志口时一个事件都不发，读写照旧 ──────────────────────────────────
    // 句柄在打开那一刻就把日志口收下了，所以先关掉所有句柄再断言「没接就不发」。
    library.setSnapshotLogSink(null)
    library.closeSnapshotLibraries()
    sink.reset()
    const silent = await library.recordIssueRows({ workspaceRoot: root, backend: 'github', repoIdentity: ROOT_KEY, rows: [issueOf('4', '没接日志口时写的票')] })
    check(silent.ok === true && silent.rows === 1, 'D1 没接日志口时写入照常成功', silent)
    check(sink.takeAllNames().length === 0, 'D2 没接日志口时一个事件都不发（与可选注入的既有约定一致）', sink.takeAllNames())

    const replay = await library.readSnapshotReplay({ workspaceRoot: root, backend: 'github', repoIdentity: ROOT_KEY, repo: { backend: 'github', refId: ROOT_KEY, name: 'x', url: '' } as any })
    check(!!replay && replay.rows === 2, 'D3 关掉日志不影响读回放（重建后写进去的两张票都在）', replay && replay.rows)

    // ── E. 常驻申报：三族信息级事件必须写进 LOG_EVENT_LIST，否则真机日志一行都没有 ──
    // 这是 2026-11-04 第一次真机演练发现的缺口：注入点接上了，但事件没申报成常驻，日志包按
    // 「未申报的信息级」丢弃，workspaceSnapshot.open / lease / ingest 在真机日志里一条都查不到。
    const declared: any = (LOG_EVENT_LIST && LOG_EVENT_LIST.events) || {}
    const declaredWant: Record<string, string[]> = {
      'workspaceSnapshot.open': ['backend', 'rootHash', 'repoHash', 'dbExisted', 'journalMode', 'mode', 'reason', 'mergeVersion'],
      'workspaceSnapshot.lease': ['acquired', 'ownerHash', 'reason', 'detail', 'nowMs'],
      'workspaceSnapshot.ingest': ['committed', 'reason', 'writes', 'startMergeVersion', 'mergeVersion', 'elapsedMs', 'detail'],
    }
    for (const name of Object.keys(declaredWant)) {
      const entry = declared[name]
      const got = (entry && Array.isArray(entry.fields)) ? entry.fields.slice().sort().join('|') : ''
      const want = declaredWant[name].slice().sort().join('|')
      check(!!entry && entry.level === 'info' && entry.kind === 'resident' && got === want, 'E 常驻申报包含 ' + name + '，字段与附录一致', entry)
    }
  } finally {
    library.setSnapshotLogSink(null)
    library.closeSnapshotLibraries()
    for (let i = 0; i < 3; i += 1) { try { rmSync(root, { recursive: true, force: true }); break } catch (e) { if (i === 2) console.log('提示：临时目录没能立刻删掉（Windows 上文件刚关掉时常见）：' + String((e as any) && (e as any).message)) } }
  }
  printGateResult(GATE, total, failed)
}

main().catch((e) => {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exitCode = 1
})
