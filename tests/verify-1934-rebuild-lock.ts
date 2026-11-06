/**
 * tests/verify-1934-rebuild-lock.ts —— 整库重建的库外短时互斥（#1934，规格 #1930 §2.6）
 *
 * 守什么（票面验收逐条落在这里）：
 *   A 库外锁：锁目录在库文件旁边（dbPath + '.rebuild-lock'），原子获取；owner.json 记持有者、
 *     过期时间与 fencing token；同一时刻只有一家人拿得到；释放之后目录消失、下一个人拿得到。
 *   B 过期锁：过期、坏掉或没有 owner.json 的锁目录被安全清理；清理只把旧目录改名到唯一名字再删，
 *     两个进程同时清也只有一个能成功；清理之后新的一家拿到锁。
 *   C 失败释放：持锁期间回调抛错，锁必须立刻释放——否则一次失败会把整个工作区锁死到 TTL。
 *   D fencing：拿到锁之后 owner.json 被别人改掉（旧重建者恢复、别人清掉过期锁之后接手），
 *     删除前的复核必须抛 RebuildLockLostError，并且绝不删库、绝不删别人的锁目录。
 *   E 五条重建分支都走同一把库外锁：损坏、initialize 撞名、迁移失败、迁移后 meta 缺失、
 *     身份不符、结构版本比本代码新——每条分支都先摆一把过期锁，重建成功且那把过期锁被清掉，
 *     证明重建确实经过 acquire（绕开锁的分支会把过期锁原样留在那里）。
 *   F 两个真子进程同时打开同一个损坏库：只有一个 .corrupt- 备份、两边最终都是可写句柄、
 *     各写的那一张票都在库里；重建期间锁目录确实存在过，结束后消失。
 *   G 拿不到锁的那个进程只是在等：父进程持锁时子进程等在门外，子进程没有抢锁、没有删库；
 *     父进程一放，子进程接着把库重建好。
 *   H 「等不到锁」不许被 openForWriting 的只读兜底吞掉：身份不符的可读库 + 别人持锁时，
 *     开库抛可识别的 RebuildBusyError，库文件一个字节不改——不是回一个只读句柄。
 *
 * 为什么用真文件系统与真子进程：这一票的结论全是「两个进程抢同一个目录会怎样」，
 * 进程内替身盖住的正是要证的那件事。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1934-rebuild-lock.ts
 */
// 门禁归属: src/workspace-snapshot/runtime/rebuild-lock.ts
// 门禁归属: src/workspace-snapshot/runtime/open-schema.ts
// 门禁归属: src/workspace-snapshot/runtime/open.ts

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { printGateResult } from './lib/gate-result.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import { issueWritesOf } from '../src/refresh/rooms/host/snapshot-library-adapter.ts'
import {
  acquireRebuildLock,
  RebuildBusyError,
  RebuildLockLostError,
  withRebuildLock,
} from '../src/workspace-snapshot/runtime/rebuild-lock.ts'
import type { Issue } from '../src/tracker/contract/entities.ts'

const GATE = 'verify-1934-rebuild-lock'
const SELF = fileURLToPath(import.meta.url)
const HOOK = path.join(path.dirname(SELF), '..', 'scripts', 'ts-hook.mts')
const LOCK_SUFFIX = '.rebuild-lock'
const REPO = 'acme/widgets'
let total = 0
let failed = 0

function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** 读锁目录里的 owner.json；读不到回 null（门禁据此断言「文件在不在、字段全不全」）。 */
function ownerOf(dbPath: string): any {
  try {
    return JSON.parse(readFileSync(dbPath + LOCK_SUFFIX + path.sep + 'owner.json', 'utf8'))
  } catch {
    return null
  }
}

function lockDirOf(dbPath: string): string {
  return dbPath + LOCK_SUFFIX
}

/** 锁目录旁边以 .stale- / .new- 开头的残留（清理过期锁、建锁途中留下的垃圾）。 */
function leftoversOf(dbPath: string): string[] {
  const dir = path.dirname(dbPath)
  const base = path.basename(dbPath) + LOCK_SUFFIX
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.indexOf(base + '.stale-') === 0 || name.indexOf(base + '.new-') === 0)
}

/** 重建留下的坏库备份（.corrupt-*）。 */
function backupsOf(dbPath: string): string[] {
  const dir = path.dirname(dbPath)
  if (!existsSync(dir)) return []
  const base = path.basename(dbPath) + '.corrupt-'
  return readdirSync(dir).filter((name) => name.indexOf(base) === 0)
}

function writeOwner(dbPath: string, owner: any): void {
  mkdirSync(lockDirOf(dbPath), { recursive: true })
  writeFileSync(path.join(lockDirOf(dbPath), 'owner.json'), JSON.stringify(owner))
}

/** 摆一把过期的锁：重建分支应当把它清掉，绕开锁的分支只会原样留着。 */
function writeExpiredLock(dbPath: string): void {
  writeOwner(dbPath, { owner: 'stale-owner', fencing: 'stale-fencing', expiresMs: Date.now() - 60000 })
}

function garbageDatabase(dbPath: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  writeFileSync(dbPath, '这不是一个 SQLite 文件')
}

/** 走与界面同一条入口开库（storageKind 固定 local：门禁不依赖跑在哪种盘上）。 */
function openGateSnapshot(workspaceRoot: string, dbPath: string, repoIdentity: string): any {
  return openWorkspaceSnapshot({
    workspaceRoot,
    backend: 'github',
    repoIdentity,
    dbPath,
    now: () => Date.now(),
    storageKind: 'local',
  })
}

function codeOf(opened: any): string[] {
  return opened.diagnostics.map((item: any) => item.code)
}

function detailOf(opened: any, code: string): string {
  const hit = opened.diagnostics.filter((item: any) => item.code === code)[0]
  return hit && hit.detail ? String(hit.detail) : ''
}

function messageOf(opened: any, code: string): string {
  const hit = opened.diagnostics.filter((item: any) => item.code === code)[0]
  return hit && hit.message ? String(hit.message) : ''
}

function issueOf(key: string, title: string): Issue {
  return {
    key,
    effortId: '',
    type: 'issue',
    title,
    state: 'open',
    body: '',
    url: 'https://github.com/' + REPO + '/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [],
  } as Issue
}

interface RunResult { out: string, err: string, code: number | null }

/** 起一个子进程跑本文件的 --driver；out/err 由 state 实时累积（父进程要中途看它走到哪一步）。 */
function spawnChild(args: string[]): { done: Promise<RunResult>, state: { out: string, err: string } } {
  const state = { out: '', err: '' }
  const child = spawn(process.execPath, ['--import', pathToFileURL(HOOK).href, SELF, '--driver', ...args], {
    cwd: path.dirname(SELF),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d: any) => { state.out += String(d) })
  child.stderr.on('data', (d: any) => { state.err += String(d) })
  const done = new Promise<RunResult>((resolve) => {
    child.on('exit', (code: number | null) => resolve({ out: state.out, err: state.err, code }))
  })
  return { done, state }
}

/** 等子进程打出某一句话（装载源码需要一会儿，别用一个拍脑袋的固定睡眠）。 */
async function waitForOutput(state: { out: string }, needle: string, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (state.out.indexOf(needle) >= 0) return true
    await sleep(10)
  }
  return false
}

function driverResultOf(out: string): any {
  const line = out.split(/\r?\n/).filter((row) => row.indexOf('DRIVER DONE ') === 0).pop()
  if (!line) return null
  try {
    return JSON.parse(line.slice('DRIVER DONE '.length))
  } catch {
    return null
  }
}

async function driverMain(argv: string[]): Promise<void> {
  const workspaceRoot = argv[0]
  const dbPath = argv[1]
  const key = argv[2]
  console.log('DRIVER START')
  const opened = openGateSnapshot(workspaceRoot, dbPath, REPO)
  const result = opened.handle.ingest({
    startMergeVersion: opened.handle.getMergeVersion(),
    writes: issueWritesOf([issueOf(key, key + ' 写的票')]),
  })
  const version = opened.handle.getMergeVersion()
  opened.handle.close()
  console.log('DRIVER DONE ' + JSON.stringify({
    mode: opened.mode,
    committed: result.committed,
    version,
    codes: codeOf(opened),
  }))
}

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1934-'))
  const workspaceDir = path.join(tempRoot, 'workspace')
  mkdirSync(path.join(workspaceDir, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(workspaceDir, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1934\n')
  // 子进程里会 import 同一份源码；让 Node 用本文件的解释器与钩子。
  try {
    // ── A 库外锁：原子获取、同一时刻只有一家人、释放之后下一个人拿得到 ──────────────
    {
      const dbPath = path.join(tempRoot, 'a', 'snapshot.sqlite')
      mkdirSync(path.dirname(dbPath), { recursive: true })
      const first = acquireRebuildLock(dbPath)
      const owner = ownerOf(dbPath)
      check(first !== null && existsSync(lockDirOf(dbPath)),
        'A1 锁目录建在库文件旁边（dbPath + .rebuild-lock），拿到锁就存在', { lock: first !== null })
      check(!!owner && typeof owner.owner === 'string' && owner.owner.length > 0
        && typeof owner.fencing === 'string' && owner.fencing.length > 0
        && Number.isFinite(Number(owner.expiresMs)),
        'A2 owner.json 记着持有者、fencing token 与过期时间', owner)
      check(!!owner && Number(owner.expiresMs) > Date.now(),
        'A3 锁带一个未来的过期时间（持锁期间按 TTL 续期，不是永不过期）', owner && owner.expiresMs)
      check(first !== null && first!.fencingToken === owner.fencing,
        'A4 句柄里的 fencing token 与 owner.json 写下的那一枚是同一个', { handle: first && first!.fencingToken, owner: owner && owner.fencing })

      const second = acquireRebuildLock(dbPath, { waitMs: 200 })
      check(second === null, 'A5 锁被拿着时第二家人等一小会儿之后放弃（不硬抢）', { second: second !== null })
      check(ownerOf(dbPath).fencing === owner.fencing,
        'A6 抢不到的那一家人一个字节都没改 owner.json', ownerOf(dbPath))

      first!.release()
      check(!existsSync(lockDirOf(dbPath)), 'A7 释放之后锁目录消失', existsSync(lockDirOf(dbPath)))
      const third = acquireRebuildLock(dbPath, { waitMs: 200 })
      check(third !== null, 'A8 释放之后下一个人立刻拿得到', { third: third !== null })
      third!.release()
      check(leftoversOf(dbPath).length === 0, 'A9 拿锁与放锁不留下 .new- / .stale- 垃圾目录', leftoversOf(dbPath))
    }

    // ── B 过期锁：安全清理，清理之后新的一家拿到；无主目录也按垃圾清掉 ──────────────
    {
      const dbPath = path.join(tempRoot, 'b', 'snapshot.sqlite')
      mkdirSync(path.dirname(dbPath), { recursive: true })
      writeExpiredLock(dbPath)
      const acquired = acquireRebuildLock(dbPath, { waitMs: 500 })
      check(acquired !== null && ownerOf(dbPath).fencing !== 'stale-fencing',
        'B1 过期锁被清掉，新的一家拿到锁并把 owner.json 换成自己的', acquired && ownerOf(dbPath))
      check(leftoversOf(dbPath).length === 0,
        'B2 清理过期锁走「改名到唯一名字再删」，不留下 .stale- 垃圾', leftoversOf(dbPath))
      acquired!.release()

      writeOwner(dbPath, { owner: 'broken', fencing: '', expiresMs: 0 })
      const broken = acquireRebuildLock(dbPath, { waitMs: 500 })
      check(broken !== null, 'B3 owner.json 坏掉（读不出合法字段）的锁目录也按过期处理', { broken: broken !== null })
      broken!.release()

      // 没有 owner.json 的目录：只可能是上一轮清理 / 别的工具留下的垃圾，按过期处理。
      rmSync(lockDirOf(dbPath), { recursive: true, force: true })
      mkdirSync(lockDirOf(dbPath), { recursive: true })
      const unowned = acquireRebuildLock(dbPath, { waitMs: 500 })
      check(unowned !== null && !!ownerOf(dbPath),
        'B4 没有 owner.json 的锁目录按垃圾清掉，重试时自己写一份完整的 owner.json', { unowned: unowned !== null })
      unowned!.release()
    }

    // ── C 失败释放：回调抛错也必须立刻把锁放掉 ────────────────────────────────────
    {
      const dbPath = path.join(tempRoot, 'c', 'snapshot.sqlite')
      mkdirSync(path.dirname(dbPath), { recursive: true })
      let thrown: unknown = null
      try {
        withRebuildLock(dbPath, undefined, () => {
          throw new Error('重建到一半失败')
        })
      } catch (error) {
        thrown = error
      }
      check(thrown instanceof Error && (thrown as Error).message === '重建到一半失败',
        'C1 回调里的错误原样抛给调用方（不吞成「拿不到锁」）', thrown && (thrown as Error).message)
      check(!existsSync(lockDirOf(dbPath)), 'C2 失败之后锁目录被删掉（下一次不用等 TTL）', existsSync(lockDirOf(dbPath)))
      const after = acquireRebuildLock(dbPath, { waitMs: 200 })
      check(after !== null, 'C3 失败之后下一个人立刻拿得到锁', { after: after !== null })
      after!.release()
    }

    // ── D fencing：删库前的复核发现 token 变了，绝不删库、绝不删别人的锁 ────────────
    {
      const dbPath = path.join(tempRoot, 'd', 'snapshot.sqlite')
      mkdirSync(path.dirname(dbPath), { recursive: true })
      writeFileSync(dbPath, '库文件还在，谁都不许删')
      const lock = acquireRebuildLock(dbPath, { waitMs: 200 })!
      const tampered = { owner: 'other-rebuilder', fencing: 'other-fencing', expiresMs: Date.now() + 60000 }
      writeFileSync(path.join(lockDirOf(dbPath), 'owner.json'), JSON.stringify(tampered))
      let lost: unknown = null
      try {
        lock.assertHeld('before-delete')
      } catch (error) {
        lost = error
      }
      check(lost instanceof RebuildLockLostError && (lost as any).code === 'rebuild-lock-lost',
        'D1 复核发现 owner.json 的 fencing 变了：抛 RebuildLockLostError（带稳定 code）', lost && { name: (lost as any).name, code: (lost as any).code })
      check(existsSync(dbPath) && readFileSync(dbPath, 'utf8') === '库文件还在，谁都不许删',
        'D2 复核失败之后库文件一个字节都没动（旧重建者不许误删新库）', existsSync(dbPath))
      lock.release()
      check(existsSync(lockDirOf(dbPath)) && ownerOf(dbPath).fencing === 'other-fencing',
        'D3 复核失败的这一家释放时不删别人的锁目录（那是现在持有者的）', ownerOf(dbPath))
      rmSync(lockDirOf(dbPath), { recursive: true, force: true })
    }

    // ── E 五条重建分支都走同一把库外锁（过期锁被清掉 = 这一支确实经过 acquire）────
    {
      const dir = path.join(tempRoot, 'e')
      mkdirSync(dir, { recursive: true })

      const corruptPath = path.join(dir, 'corrupt.sqlite')
      garbageDatabase(corruptPath)
      writeExpiredLock(corruptPath)
      const corrupt = openGateSnapshot(workspaceDir, corruptPath, REPO)
      check(codeOf(corrupt).indexOf('corrupt-rebuilt') >= 0 && !existsSync(lockDirOf(corruptPath)),
        'E1 损坏重建：走锁、清掉过期锁、留 corrupt-rebuilt 诊断', { codes: codeOf(corrupt), lock: existsSync(lockDirOf(corruptPath)) })
      check(backupsOf(corruptPath).length === 1, 'E2 损坏重建只留一份 .corrupt- 备份', backupsOf(corruptPath))
      corrupt.handle.close()

      const foreignPath = path.join(dir, 'foreign.sqlite')
      mkdirSync(path.dirname(foreignPath), { recursive: true })
      const foreign = new DatabaseSync(foreignPath)
      foreign.exec('CREATE TABLE meta (id INTEGER PRIMARY KEY)')
      foreign.close()
      writeExpiredLock(foreignPath)
      const resetInit = openGateSnapshot(workspaceDir, foreignPath, REPO)
      check(codeOf(resetInit).indexOf('schema-reset') >= 0
        && messageOf(resetInit, 'schema-reset').indexOf('目标文件不是本工具的库结构') >= 0
        && !existsSync(lockDirOf(foreignPath)),
        'E3 initialize 撞名的重建：走锁、清掉过期锁、留 schema-reset 诊断', { message: messageOf(resetInit, 'schema-reset'), lock: existsSync(lockDirOf(foreignPath)) })
      resetInit.handle.close()

      const migrateFailPath = path.join(dir, 'migrate-fail.sqlite')
      const migrateFail = new DatabaseSync(migrateFailPath)
      migrateFail.exec('PRAGMA user_version = 2')
      migrateFail.close()
      writeExpiredLock(migrateFailPath)
      const resetMigrate = openGateSnapshot(workspaceDir, migrateFailPath, REPO)
      check(codeOf(resetMigrate).indexOf('schema-reset') >= 0
        && detailOf(resetMigrate, 'schema-reset').indexOf('迁移失败') >= 0
        && !existsSync(lockDirOf(migrateFailPath)),
        'E4 迁移失败的重建：走锁、清掉过期锁、detail 说清是迁移失败', { detail: detailOf(resetMigrate, 'schema-reset'), lock: existsSync(lockDirOf(migrateFailPath)) })
      resetMigrate.handle.close()

      const metaMissingPath = path.join(dir, 'meta-missing.sqlite')
      const metaMissing = new DatabaseSync(metaMissingPath)
      metaMissing.exec('CREATE TABLE meta (id INTEGER PRIMARY KEY, schema_version INTEGER)')
      metaMissing.exec('CREATE TABLE issue (issue_id INTEGER PRIMARY KEY)')
      metaMissing.exec('CREATE TABLE issue_group (issue_id INTEGER, group_name TEXT)')
      metaMissing.exec('PRAGMA user_version = 1')
      metaMissing.close()
      writeExpiredLock(metaMissingPath)
      const resetMeta = openGateSnapshot(workspaceDir, metaMissingPath, REPO)
      check(codeOf(resetMeta).indexOf('schema-reset') >= 0
        && detailOf(resetMeta, 'schema-reset').indexOf('meta 行缺失') >= 0
        && !existsSync(lockDirOf(metaMissingPath)),
        'E5 迁移后 meta 缺失的重建：走锁、清掉过期锁、detail 说清 meta 缺失', { detail: detailOf(resetMeta, 'schema-reset'), lock: existsSync(lockDirOf(metaMissingPath)) })
      resetMeta.handle.close()

      const identityPath = path.join(dir, 'identity.sqlite')
      const ownerA = openGateSnapshot(workspaceDir, identityPath, 'repo-a')
      ownerA.handle.close()
      writeExpiredLock(identityPath)
      const ownerB = openGateSnapshot(workspaceDir, identityPath, 'repo-b')
      check(codeOf(ownerB).indexOf('identity-mismatch-rebuilt') >= 0
        && !existsSync(lockDirOf(identityPath)),
        'E6 身份不符的重建：走锁、清掉过期锁、留 identity-mismatch-rebuilt 诊断', { codes: codeOf(ownerB), lock: existsSync(lockDirOf(identityPath)) })
      ownerB.handle.close()

      const tooNewPath = path.join(dir, 'too-new.sqlite')
      const tooNew = new DatabaseSync(tooNewPath)
      tooNew.exec('PRAGMA user_version = 99')
      tooNew.close()
      writeExpiredLock(tooNewPath)
      const resetNew = openGateSnapshot(workspaceDir, tooNewPath, REPO)
      check(codeOf(resetNew).indexOf('schema-reset') >= 0
        && detailOf(resetNew, 'schema-reset').indexOf('比本代码新') >= 0
        && !existsSync(lockDirOf(tooNewPath)),
        'E7 结构版本比本代码新的重建：走锁、清掉过期锁、detail 说清版本比代码新', { detail: detailOf(resetNew, 'schema-reset'), lock: existsSync(lockDirOf(tooNewPath)) })
      resetNew.handle.close()

      // 库本身可用时根本不拿锁：别人正拿着重建锁也照样立刻开库（重建互斥不该拖慢普通开库）。
      const plainPath = path.join(dir, 'plain.sqlite')
      const plain = openGateSnapshot(workspaceDir, plainPath, REPO)
      plain.handle.close()
      const busyLock = acquireRebuildLock(plainPath, { waitMs: 200 })!
      const startedAt = Date.now()
      const whileBusy = openGateSnapshot(workspaceDir, plainPath, REPO)
      check(whileBusy.mode === 'writable' && Date.now() - startedAt < 2000 && codeOf(whileBusy).length === 0,
        'E8 库本身可用时不拿锁、不等锁：别人正拿着重建锁也照样立刻开库',
        { mode: whileBusy.mode, elapsedMs: Date.now() - startedAt, codes: codeOf(whileBusy) })
      whileBusy.handle.close()
      busyLock.release()
    }

    // ── F 两个真子进程同时打开同一个损坏库：只有一个重建，两边最后都能写 ────────────
    {
      const racePath = path.join(tempRoot, 'f', 'snapshot.sqlite')
      garbageDatabase(racePath)
      const one = spawnChild([workspaceDir, racePath, 'K1'])
      const two = spawnChild([workspaceDir, racePath, 'K2'])
      let sawLock = false
      const poll = setInterval(() => { if (existsSync(lockDirOf(racePath))) sawLock = true }, 2)
      const [first, second] = await Promise.all([one.done, two.done])
      clearInterval(poll)
      const firstResult = driverResultOf(first.out)
      const secondResult = driverResultOf(second.out)
      check(first.code === 0 && second.code === 0 && !!firstResult && !!secondResult,
        'F1 两个子进程都正常退出并交出结果（两边都开着同一个损坏库）',
        { one: first.code, two: second.code, err: (first.err + second.err).slice(-200) })
      check(backupsOf(racePath).length === 1,
        'F2 只有一个进程真的重建：.corrupt- 备份只有一份', backupsOf(racePath))
      check(firstResult && secondResult && firstResult.mode === 'writable' && secondResult.mode === 'writable',
        'F3 等待的那一边最后拿到的是可写句柄（不是只读、也不是报错）', { one: firstResult && firstResult.mode, two: secondResult && secondResult.mode })
      check(firstResult && secondResult && firstResult.committed === true && secondResult.committed === true,
        'F4 两边各写的一笔都提交成功', { one: firstResult && firstResult.committed, two: secondResult && secondResult.committed })
      // 两笔写是串行提交的：先到的那笔从 1 提交成 1，后到的那笔看到 1、提交成 2。
      // 两个版本加起来必须是 3——这说明两笔都真的落库了，而不是有一笔在等锁期间被吞掉。
      check(!!firstResult && !!secondResult
        && Math.min(firstResult.version, secondResult.version) >= 1
        && firstResult.version + secondResult.version === 3,
        'F5 两笔写入串行提交（版本合计 3：一笔提交成 1，另一笔从 1 提交成 2）',
        { one: firstResult && firstResult.version, two: secondResult && secondResult.version })

      const after = openGateSnapshot(workspaceDir, racePath, REPO)
      const keys = after.handle.readList({ state: 'all' }).issues.map((item: any) => String(item.key)).sort()
      check(keys.join(',') === 'K1,K2', 'F6 重建后的库里两张票都在（等待者没有把新库删掉重来）', keys)
      after.handle.close()

      check(sawLock, 'F7 重建期间锁目录确实出现过（不是靠进程启动顺序侥幸）')
      check(!existsSync(lockDirOf(racePath)), 'F8 两边都结束之后锁目录消失', existsSync(lockDirOf(racePath)))
      check(leftoversOf(racePath).length === 0, 'F9 抢锁与等锁没有留下 .new- / .stale- 垃圾', leftoversOf(racePath))
    }

    // ── G 拿不到锁的进程只是在等：父进程持锁时它不抢、不删，父进程一放它接着干 ──────
    {
      const waitPath = path.join(tempRoot, 'g', 'snapshot.sqlite')
      garbageDatabase(waitPath)
      const holder = acquireRebuildLock(waitPath, { waitMs: 200 })!
      const holderFencing = ownerOf(waitPath).fencing
      const child = spawnChild([workspaceDir, waitPath, 'W1'])
      const started = await waitForOutput(child.state, 'DRIVER START', 30000)
      check(started, 'G1 子进程开始开库（DRIVER START）', child.state.out.slice(-200) + child.state.err.slice(-200))
      await sleep(300)
      check(existsSync(lockDirOf(waitPath)) && ownerOf(waitPath).fencing === holderFencing,
        'G2 等锁期间父进程的锁与 owner.json 都没被动过（等在门外，不抢）', ownerOf(waitPath))
      check(existsSync(waitPath) && readFileSync(waitPath, 'utf8') === '这不是一个 SQLite 文件',
        'G3 等锁期间子进程没有删库、也没有另建一份', existsSync(waitPath))
      holder.release()
      const waited = await child.done
      const waitedResult = driverResultOf(waited.out)
      check(waited.code === 0 && !!waitedResult && waitedResult.mode === 'writable' && waitedResult.committed === true,
        'G4 父进程一放锁，子进程接着把库重建好并写进一张票',
        { code: waited.code, result: waitedResult, err: waited.err.slice(-200) })
      check(!!waitedResult && waitedResult.codes.indexOf('corrupt-rebuilt') >= 0,
        'G5 重建是子进程做的（诊断里有 corrupt-rebuilt）', waitedResult && waitedResult.codes)
      check(!existsSync(lockDirOf(waitPath)), 'G6 子进程重建完之后锁目录消失', existsSync(lockDirOf(waitPath)))
      check(backupsOf(waitPath).length === 1, 'G7 等待之后的重建只留一份备份', backupsOf(waitPath))
    }

    // ── H 等不到锁不许被只读兜底吞掉：抛 RebuildBusyError，库一个字节不改 ──────────
    {
      const busyPath = path.join(tempRoot, 'h', 'snapshot.sqlite')
      const ownerA = openGateSnapshot(workspaceDir, busyPath, 'repo-a')
      ownerA.handle.close()
      const holder = acquireRebuildLock(busyPath, { waitMs: 200 })!
      const holderFencing = ownerOf(busyPath).fencing
      // 目录名说明这一次为什么该等：身份不符本来要重建，而另一个进程正拿着重建锁。
      let thrown: unknown = null
      try {
        openGateSnapshot(workspaceDir, busyPath, 'repo-b')
      } catch (error) {
        thrown = error
      }
      check(thrown instanceof RebuildBusyError && (thrown as any).code === 'rebuild-busy',
        'H1 等不到重建锁：开库抛可识别的 RebuildBusyError（不是只读句柄）', thrown && { name: (thrown as any).name, code: (thrown as any).code })
      check(thrown instanceof Error && String((thrown as Error).message).indexOf('另一个窗口正在重建快照库') >= 0,
        'H2 错误消息说清「另一个窗口正在重建快照库，稍后重试」', thrown && (thrown as Error).message)
      const probe = new DatabaseSync(busyPath)
      let repoOfOld = ''
      try {
        const row = probe.prepare('SELECT repo_identity FROM meta WHERE id = 1').get() as any
        repoOfOld = row ? String(row.repo_identity) : ''
      } finally {
        probe.close()
      }
      check(repoOfOld === 'repo-a',
        'H3 等不到锁时库文件与里面 repo-a 的数据一个字节都没改（没有先删库再发现拿不到锁）', repoOfOld)
      check(existsSync(lockDirOf(busyPath)) && ownerOf(busyPath).fencing === holderFencing,
        'H4 等不到锁的进程没有清掉别人未过期的锁目录', ownerOf(busyPath))
      check(backupsOf(busyPath).length === 0, 'H5 等不到锁时没有产生任何 .corrupt- 备份', backupsOf(busyPath))
      holder.release()
    }

    // ── I handle.rebuild() 也走同一把锁：过期锁被清掉 = 走了锁；拿不到锁时不删库、句柄还能用 ──
    {
      const rebuildPath = path.join(tempRoot, 'i', 'snapshot.sqlite')
      const opened = openGateSnapshot(workspaceDir, rebuildPath, REPO)
      opened.handle.ingest({
        startMergeVersion: opened.handle.getMergeVersion(),
        writes: issueWritesOf([issueOf('R1', '重建前写进去的票')]),
      })
      writeExpiredLock(rebuildPath)
      opened.handle.rebuild()
      check(!existsSync(lockDirOf(rebuildPath)) && opened.handle.getMergeVersion() === 0,
        'I1 handle.rebuild() 经过库外锁：清掉过期锁、库回到空库（版本 0）',
        { lock: existsSync(lockDirOf(rebuildPath)), version: opened.handle.getMergeVersion() })
      check(opened.handle.readList({ state: 'all' }).issues.length === 0,
        'I2 重建之后旧行不在了（清空后按当前身份建空库）', opened.handle.readList({ state: 'all' }).issues.length)
      opened.handle.close()
    }
    {
      const busyPath = path.join(tempRoot, 'i', 'busy.sqlite')
      const opened = openGateSnapshot(workspaceDir, busyPath, REPO)
      opened.handle.ingest({
        startMergeVersion: opened.handle.getMergeVersion(),
        writes: issueWritesOf([issueOf('R2', '重建前写进去的票')]),
      })
      const holder = acquireRebuildLock(busyPath, { waitMs: 200 })!
      const holderFencing = ownerOf(busyPath).fencing
      let thrown: unknown = null
      try {
        opened.handle.rebuild()
      } catch (error) {
        thrown = error
      }
      check(thrown instanceof RebuildBusyError && (thrown as any).code === 'rebuild-busy',
        'I3 handle.rebuild() 拿不到锁时抛可识别的 RebuildBusyError', thrown && { name: (thrown as any).name, code: (thrown as any).code })
      const wrote = opened.handle.ingest({
        startMergeVersion: opened.handle.getMergeVersion(),
        writes: issueWritesOf([issueOf('R3', '重建没做成之后写的票')]),
      })
      check(wrote.committed === true && opened.handle.getMergeVersion() === 2,
        'I4 拿不到锁时句柄还能照常用（先拿锁再关连接，不让一次「稍后重试」把句柄变成废物）',
        { wrote, version: opened.handle.getMergeVersion() })
      check(opened.handle.readList({ state: 'all' }).issues.length === 2,
        'I5 拿不到锁时库里的两行一张都没少（没有先删库再发现拿不到锁）', opened.handle.readList({ state: 'all' }).issues.length)
      check(existsSync(lockDirOf(busyPath)) && ownerOf(busyPath).fencing === holderFencing,
        'I6 拿不到锁时没有清掉别人未过期的锁', ownerOf(busyPath))
      opened.handle.close()
      holder.release()
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }

  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 整库重建库外互斥门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

if (process.argv.includes('--driver')) {
  driverMain(process.argv.slice(process.argv.indexOf('--driver') + 1)).catch((error) => {
    console.log('DRIVER FAIL ' + ((error && error.stack) || error))
    process.exitCode = 1
  })
} else {
  main().catch((error) => {
    console.log('FAIL 门禁异常退出：' + ((error && error.stack) || error))
    printGateResult(GATE, total, failed + 1)
    process.exitCode = 1
  })
}
