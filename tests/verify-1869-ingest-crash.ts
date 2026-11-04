/**
 * tests/verify-1869-ingest-crash.ts —— 写事务中间被杀，重开必须是上一轮的完整数据（#1869 的 1869-02）
 *
 * 治的是什么：整轮刷新把几千张票收进内存后，用一个事务写进快照库。只保证「每 200 条一批原子」
 * 不够——写到一半被杀，库里会留下「前几批新、后几批旧」的半新半旧。这一扇门禁真的起一个子进程，
 * 让它用 recordIssueRows({ atomic:true }) 写 6000 行，等它拿到写锁并持续 30 毫秒后 SIGKILL；
 * 重开库必须仍是上一轮的完整数据，再正常写一次必须全部变成新数据。
 *
 * 为什么等「写锁持续 30 毫秒」：抢租约也是一次 BEGIN IMMEDIATE，但那是毫秒级的；能持续 30 毫秒
 * 不退的写锁只可能是 ingest 的那一个事务（见 src/workspace-snapshot/runtime/ingest.ts 第 85 行起）。
 *
 * 被杀的子进程会留下未过期的租约（默认 15 秒）。门禁直接清掉租约行，等价于等它过期，
 * 只为把这一扇跑快；租约过期本身由 #1862 的门禁守，不在这里重复。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1869-ingest-crash.ts
 */
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts
// 门禁归属: src/workspace-snapshot/runtime/ingest.ts

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { printGateResult } from './lib/gate-result.ts'
import { recordIssueRows, readSnapshotReplay, closeSnapshotLibraries } from '../src/refresh/rooms/host/snapshot-library.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'

const GATE = 'verify-1869-ingest-crash'
const SELF = fileURLToPath(import.meta.url)
const HOOK = path.join(path.dirname(SELF), '..', 'scripts', 'ts-hook.mts')
const REF: RepositoryRef = { backend: 'github', refId: 'acme/widgets', name: 'widgets', url: 'https://github.com/acme/widgets' }
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
    effortId: '',
    type: input.type || 'issue',
    title: input.title,
    state: input.state || 'open',
    body: '',
    url: 'https://github.com/acme/widgets/issues/' + input.key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: input.parentKey === undefined ? null : input.parentKey,
  }
  return Object.assign(base, input)
}

function seedRows(prefix: string): Issue[] {
  return [
    issue({ key: '100', type: 'map', title: prefix + '容器' }),
    issue({ key: '5', title: prefix + '子票五', parentKey: '100' }),
    issue({ key: '7', title: prefix + '独立票' }),
  ]
}

function bigRows(prefix: string, count: number): Issue[] {
  const rows: Issue[] = [issue({ key: '100', type: 'map', title: prefix + '容器' })]
  for (let i = 0; i < count; i += 1) {
    rows.push(issue({ key: String(1000 + i), title: prefix + '票' + i, parentKey: i === 0 ? '100' : null }))
  }
  return rows
}

function dbPathOf(root: string): string {
  const dir = path.join(root, '.dsh-mattskillsdeck-cache', 'snapshot')
  const hit = readdirSync(dir).filter((n) => n.endsWith('.sqlite'))[0]
  if (!hit) throw new Error('快照库文件不在：' + dir)
  return path.join(dir, hit)
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

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** 打开探测连接，轮询到写锁连续 heldMs 毫秒都不放；拿到就回 true（子进程的 ingest 正在进行）。 */
function waitForHeldWriteLock(dbPath: string, heldMs: number, timeoutMs: number): boolean {
  const end = Date.now() + timeoutMs
  let busySince = 0
  while (Date.now() < end) {
    const probe = new DatabaseSync(dbPath, { timeout: 0 })
    let busy = false
    try {
      probe.exec('PRAGMA busy_timeout = 0')
      probe.exec('BEGIN IMMEDIATE')
      probe.exec('ROLLBACK')
    } catch (e) {
      busy = /locked|busy/i.test(String((e && (e as any).message) || e))
    } finally {
      try { probe.close() } catch { /* 探测连接关不掉不改变结论 */ }
    }
    if (busy) {
      if (busySince === 0) busySince = Date.now()
      if (Date.now() - busySince >= heldMs) return true
    } else {
      busySince = 0
    }
    sleepSync(5)
  }
  return false
}

/** 清掉被杀子进程留下的租约，等价于等 15 秒过期（只为把门禁跑快）。 */
function clearStaleLease(dbPath: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.prepare('UPDATE meta SET lease_owner = NULL, lease_heartbeat_ms = NULL, lease_expires_ms = NULL WHERE id = 1').run()
  } finally {
    db.close()
  }
}

async function replayOf(root: string): Promise<any> {
  return await readSnapshotReplay({ workspaceRoot: root, backend: 'github', repoIdentity: REF.refId, repo: REF })
}

async function driverMain(argv: string[]): Promise<void> {
  const root = argv[0]
  const count = Number(argv[1] || '6000')
  const prefix = argv[2] || '驱动新'
  console.log('DRIVER START')
  const result = await recordIssueRows({
    workspaceRoot: root,
    backend: 'github',
    repoIdentity: REF.refId,
    rows: bigRows(prefix, count),
    atomic: true,
  })
  console.log('DRIVER DONE ' + JSON.stringify(result))
}

async function main(): Promise<void> {
  if (process.argv.includes('--driver')) {
    await driverMain(process.argv.slice(process.argv.indexOf('--driver') + 1))
    return
  }

  const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-1869-ingest-crash-'))
  let child: any = null
  try {
    mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(dir, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1869-ingest-crash')

    // 先写上一轮的完整数据（三行），关掉句柄把租约放掉，再把库文件路径拿到。
    const seed = await recordIssueRows({ workspaceRoot: dir, backend: 'github', repoIdentity: REF.refId, rows: seedRows('旧'), atomic: true })
    check(seed.ok === true && seed.rows === 3, 'A1 上一轮三行先写进库', seed)
    const seedVersion = Number(seed.mergeVersion)
    closeSnapshotLibraries()
    const dbPath = dbPathOf(dir)

    // 起子进程写 6000 行；等它拿到写锁并持续 30ms（租约事务是毫秒级，撑不住这么久）。
    let stdout = ''
    let stderr = ''
    child = spawn(process.execPath, ['--import', pathToFileURL(HOOK).href, SELF, '--driver', dir, '6000', '驱动新'], {
      cwd: path.dirname(SELF),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (d: any) => { stdout += String(d) })
    child.stderr.on('data', (d: any) => { stderr += String(d) })
    const closePromise = new Promise<any>((resolve) => {
      child.on('exit', (code: number | null, signal: string | null) => resolve({ code, signal }))
    })
    const startedAt = Date.now()
    while (stdout.indexOf('DRIVER START') < 0 && Date.now() - startedAt < 60000) {
      await new Promise((r) => setTimeout(r, 10))
    }
    check(stdout.indexOf('DRIVER START') >= 0, 'A2 子进程开始写这一批（DRIVER START）', stdout.slice(0, 200) + stderr.slice(0, 200))
    await new Promise((r) => setTimeout(r, 30))
    const locked = waitForHeldWriteLock(dbPath, 30, 60000)
    check(locked, 'A3 写锁被同一个事务连续占住 30 毫秒（ingest 正在进行）')
    if (locked) {
      try { child.kill('SIGKILL') } catch { /* 已经退了就照常往下判 */ }
    }
    const closed = await Promise.race([
      closePromise,
      new Promise<any>((resolve) => setTimeout(() => resolve({ code: null, signal: null, timedOut: true }), 30000)),
    ])
    check(closed.timedOut !== true && (closed.signal === 'SIGKILL' || closed.code !== 0), 'A4 子进程在写事务中间被杀掉', closed)

    // 重开：未提交的那一批必须整批回滚，仍读得到上一轮三行，版本不前进。
    clearStaleLease(dbPath)
    const afterKill = await replayOf(dir)
    check(afterKill !== null && afterKill.rows === 3, 'B1 被杀后库里仍是上一轮的三行（没有半新半旧）', afterKill && afterKill.rows)
    check(afterKill !== null && afterKill.mergeVersion === seedVersion, 'B2 被杀后合并版本没有前进（事务没提交）', afterKill && [seedVersion, afterKill.mergeVersion])
    const oldTitles = titlesIn(afterKill)
    check(oldTitles.length === 3 && oldTitles.every((t) => t.indexOf('旧') === 0), 'B3 三行全是上一轮的旧标题', oldTitles)
    check(oldTitles.every((t) => t.indexOf('驱动新') < 0), 'B4 被回滚的那批一行都没漏进库', oldTitles)

    // 再正常写一次：三行全部变成新数据，版本前进一格。
    closeSnapshotLibraries()
    const rewrite = await recordIssueRows({ workspaceRoot: dir, backend: 'github', repoIdentity: REF.refId, rows: seedRows('新'), atomic: true })
    check(rewrite.ok === true && rewrite.rows === 3, 'C1 回滚后正常写入三行成功', rewrite)
    const afterWrite = await replayOf(dir)
    const newTitles = titlesIn(afterWrite)
    check(afterWrite !== null && afterWrite.rows === 3, 'C2 正常写入后仍是三行（没有残留重复行）', afterWrite && afterWrite.rows)
    check(afterWrite !== null && Number(afterWrite.mergeVersion) === seedVersion + 1, 'C3 正常写入只前进一格', afterWrite && [seedVersion, afterWrite.mergeVersion])
    check(newTitles.length === 3 && newTitles.every((t) => t.indexOf('新') === 0), 'C4 三行全部是这一轮的新标题', newTitles)
    check(newTitles.every((t) => t.indexOf('旧') < 0), 'C5 上一轮的旧标题一行不剩', newTitles)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { try { child.kill('SIGKILL') } catch { /* 收尾失败不掩盖结论 */ } }
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
