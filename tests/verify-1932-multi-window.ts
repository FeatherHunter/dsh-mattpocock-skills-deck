/**
 * tests/verify-1932-multi-window.ts —— 本地多窗口可写（#1932，规格 #1930）
 *
 * 守什么（票面验收逐条落在这里）：
 *   A 本地盘：同一份库上开两个句柄，两边都能写；一个开着不写不挡另一个；关掉一个之后另一个照常写。
 *     本地开库不抢租约、不写 lease_owner，也不再产生 lease-held-readonly / lease-lost-readonly 两个诊断。
 *   B 真进程：两个子进程各写一笔写回执，两笔都落库；写者按 SQLite 写锁排队（版本一格一格前进）。
 *   C 旧租约：meta 里有一条未过期的旧租约时，本地句柄仍是 writable，但 ingest / writeSyncBookkeeping /
 *     markMissing 都回 legacy-writer，诊断里有 legacy-writer-restart；租约过期后下一次写自动恢复，
 *     并把残留的租约行清掉（不要求重启本窗口）。
 *   D 网络盘回退：storageKind:'network' 时仍是单写者——第一个句柄可写、第二个退回只读
 *     （lease-held-readonly），第一个关掉之后第三个可写。lease_owner / 心跳列与配置都保留。
 *   E 设置页读数：诊断电话的回包带 storageKind 与 mode；本地是 local、网络是 network；
 *     「写模型」这一行为本地多写者 / 网络单写者回退 / 文件系统只读三种各给一个说法。
 *   F 路径判定：UNC（\\ 开头与 //server/share 两种写法）判成 network；盘符路径判成 local。
 *
 * 为什么用真 SQLite 与真子进程：这一票的全部结论都是「两个进程同时写同一份文件会怎样」，
 * 进程内替身与假事务盖住这两件事，等于把要证的结论假设进替身里。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1932-multi-window.ts
 */
// 门禁归属: src/workspace-snapshot/runtime/open.ts
// 门禁归属: src/workspace-snapshot/runtime/storage-kind.ts
// 门禁归属: src/workspace-snapshot/runtime/lease.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-read.ts
// 门禁归属: src/refresh/rooms/host/snapshot-read-channels.ts
// 门禁归属: src/client/views/shared/truthLines.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { printGateResult } from './lib/gate-result.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import { detectStorageKind } from '../src/workspace-snapshot/runtime/storage-kind.ts'
import { readLibraryStorageStats } from '../src/refresh/rooms/host/snapshot-library-read.ts'
import { closeSnapshotLibraries } from '../src/refresh/rooms/host/snapshot-library.ts'
import { createSnapshotReadChannels } from '../src/refresh/rooms/host/snapshot-read-channels.ts'
import { issueWritesOf } from '../src/refresh/rooms/host/snapshot-library-adapter.ts'
import { snapshotWriteModelReadoutOf } from '../src/client/views/shared/truthLines.ts'
import type { WorkspaceSnapshotHandle } from '../src/workspace-snapshot/contract/types.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'

const GATE = 'verify-1932-multi-window'
const SELF = fileURLToPath(import.meta.url)
const HOOK = path.join(path.dirname(SELF), '..', 'scripts', 'ts-hook.mts')
const REPO: RepositoryRef = {
  backend: 'github',
  refId: 'acme/widgets',
  name: 'acme/widgets',
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

function issueOf(key: string, title: string): Issue {
  return {
    key,
    effortId: '',
    type: 'issue',
    title,
    state: 'open',
    body: '',
    url: 'https://github.com/acme/widgets/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [],
  } as Issue
}

/** 走真句柄写一张票（与刷新那条路同一个入口：读结果一批）。 */
function writeRow(handle: WorkspaceSnapshotHandle, key: string, title: string): any {
  return handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes: issueWritesOf([issueOf(key, title)]) })
}

/** 写回执（kind:'receipt'）：写操作成功之后库层收到的那一批。 */
function writeReceipt(handle: WorkspaceSnapshotHandle, key: string, title: string): any {
  return handle.ingest({ startMergeVersion: handle.getMergeVersion(), kind: 'receipt', writes: issueWritesOf([issueOf(key, title)]) })
}

function titlesIn(handle: WorkspaceSnapshotHandle): string[] {
  return handle.readList({ state: 'all' }).issues.map((item: any) => String(item.row.title || '')).sort()
}

/** 直接改库里的 meta 租约行：模拟「旧版本窗口还拿着写权」这一档升级现场。 */
function setLeaseRow(dbPath: string, owner: string, expiresMs: number): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.prepare('UPDATE meta SET lease_owner = ?, lease_heartbeat_ms = ?, lease_expires_ms = ? WHERE id = 1')
      .run(owner, Date.now(), expiresMs)
  } finally {
    db.close()
  }
}

/** 读 meta 的租约三格：本地路径不该再写它们，残留也要看得见。 */
function leaseRowOf(dbPath: string): { owner: string | null, heartbeat: number | null, expires: number | null } {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare('SELECT lease_owner, lease_heartbeat_ms, lease_expires_ms FROM meta WHERE id = 1').get() as any
    return {
      owner: row && row.lease_owner != null ? String(row.lease_owner) : null,
      heartbeat: row && row.lease_heartbeat_ms != null ? Number(row.lease_heartbeat_ms) : null,
      expires: row && row.lease_expires_ms != null ? Number(row.lease_expires_ms) : null,
    }
  } finally {
    db.close()
  }
}

function codeOf(opened: { diagnostics: Array<{ code: string }> }): string[] {
  return opened.diagnostics.map((item) => item.code)
}

function makePhone(lib: any): any {
  return createSnapshotReadChannels({
    canonicalKey: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'github', rev: 1 }),
    getTrackerRegistry: async () => ({ describe: () => REPO, modules: () => [], get: () => ({}) }),
    getSnapshotLibrary: async () => lib,
    getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
    openSession: async () => null,
  } as any)
}

/** 子进程：打开同一份库写一笔写回执，写完打印 DONE。两个这样的进程同时跑，就是两个窗口同时写。 */
async function driverMain(argv: string[]): Promise<void> {
  const workspaceRoot = argv[0]
  const dbPath = argv[1]
  const owner = argv[2]
  const key = argv[3]
  const opened = openWorkspaceSnapshot({
    workspaceRoot,
    backend: 'github',
    repoIdentity: REPO.refId,
    dbPath,
    leaseOwner: owner,
    now: () => Date.now(),
    storageKind: 'local',
  })
  const result = writeReceipt(opened.handle, key, owner + ' 写的票')
  opened.handle.close()
  console.log('DRIVER DONE ' + JSON.stringify({ mode: opened.mode, result }))
}

async function run(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1932-'))
  const workspaceDir = path.join(tempRoot, 'workspace')
  mkdirSync(path.join(workspaceDir, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(workspaceDir, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1932\n')
  const dbPath = path.join(tempRoot, 'db', 'snapshot.sqlite')
  const openLocal = (owner: string, now?: () => number) => openWorkspaceSnapshot({
    workspaceRoot: workspaceDir,
    backend: 'github',
    repoIdentity: REPO.refId,
    dbPath,
    leaseOwner: owner,
    now: now || (() => Date.now()),
    storageKind: 'local',
  })

  // ── A 本地盘：两个句柄都能写；空闲不挡；关一个另一个照写 ─────────────────────────
  {
    const first = openLocal('gate-1932-first')
    check(first.mode === 'writable' && first.storageKind === 'local' && first.handle.storageKind === 'local',
      'A1 本地开库是可写、storageKind 是 local（结果与句柄两处都有）',
      { mode: first.mode, storageKind: first.storageKind, handle: first.handle.storageKind })
    check(codeOf(first).length === 0, 'A2 本地开库不再有「租约被占 / 租约丢失」这类诊断', codeOf(first))

    const second = openLocal('gate-1932-second')
    const a = writeRow(first.handle, 'A1', '第一个窗口写的票')
    const b = writeRow(second.handle, 'B1', '第二个窗口写的票')
    check(a.committed === true && b.committed === true && second.mode === 'writable',
      'A3 同一份本地库上两个句柄都能提交（第二个不再是只读）',
      { a, b, mode: second.mode })
    check(first.handle.getMergeVersion() === 2 && titlesIn(second.handle).join('|') === '第一个窗口写的票|第二个窗口写的票',
      'A4 两笔都落库、版本前进两格，另一个句柄立刻读得到',
      { version: first.handle.getMergeVersion(), titles: titlesIn(second.handle) })
    check(codeOf(second).every((code) => code !== 'lease-held-readonly' && code !== 'lease-lost-readonly'),
      'A5 本地第二个句柄不产生 lease-held-readonly / lease-lost-readonly', codeOf(second))

    // 空闲窗口不持有写权：本地开库与写入都不碰 meta 的租约三格。
    const row = leaseRowOf(dbPath)
    check(row.owner === null && row.heartbeat === null && row.expires === null,
      'A6 本地开库与写入都不在 meta 里留租约（空闲窗口不占用写权）', row)

    second.handle.close()
    const c = writeRow(first.handle, 'C1', '关掉一个窗口之后写的票')
    check(c.committed === true && first.handle.getMergeVersion() === 3,
      'A7 关掉另一个句柄之后，留下的句柄不需要重开就能继续写',
      { c, version: first.handle.getMergeVersion() })
    check(leaseRowOf(dbPath).owner === null, 'A8 关库也不碰租约行（本地本来就没有）', leaseRowOf(dbPath))
    first.handle.close()
  }

  // ── B 真进程：两个子进程各写一笔回执，两笔都在库里 ─────────────────────────────
  {
    const childDbPath = path.join(tempRoot, 'db', 'two-windows.sqlite')
    const seed = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir, backend: 'github', repoIdentity: REPO.refId,
      dbPath: childDbPath, now: () => Date.now(), storageKind: 'local',
    })
    writeRow(seed.handle, 'SEED', '上一轮的票')
    seed.handle.close()

    const runChild = (tag: string, key: string): Promise<{ out: string, err: string, code: number | null }> => {
      return new Promise((resolve) => {
        const child = spawn(process.execPath, ['--import', pathToFileURL(HOOK).href, SELF, '--driver', workspaceDir, childDbPath, tag, key], {
          cwd: path.dirname(SELF), stdio: ['ignore', 'pipe', 'pipe'],
        })
        let out = ''
        let err = ''
        child.stdout.on('data', (d: any) => { out += String(d) })
        child.stderr.on('data', (d: any) => { err += String(d) })
        child.on('exit', (code: number | null) => resolve({ out, err, code }))
      })
    }
    const [one, two] = await Promise.all([runChild('gate-1932-p1', 'P1'), runChild('gate-1932-p2', 'P2')])
    check(one.code === 0 && two.code === 0 && one.out.indexOf('DRIVER DONE') >= 0 && two.out.indexOf('DRIVER DONE') >= 0,
      'B1 两个子进程都写完并正常退出（两窗口同时写）',
      { one: one.out.slice(-160) + one.err.slice(-160), two: two.out.slice(-160) + two.err.slice(-160) })

    const after = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir, backend: 'github', repoIdentity: REPO.refId,
      dbPath: childDbPath, now: () => Date.now(), storageKind: 'local',
    })
    const keys = after.handle.readList({ state: 'all' }).issues.map((item: any) => String(item.key)).sort()
    check(keys.join(',') === 'P1,P2,SEED', 'B2 两个进程各写的回执都落库了（没有互相覆盖）', keys)
    check(after.handle.getMergeVersion() === 3,
      'B3 两笔回执按 SQLite 写锁排队提交，版本从 1 前进到 3', after.handle.getMergeVersion())
    after.handle.close()
  }

  // ── C 旧租约：未过期时拒绝本地写，过期后自动恢复 ───────────────────────────────
  {
    let clock = 1762400000000
    const now = () => clock
    const legacyDbPath = path.join(tempRoot, 'db', 'legacy.sqlite')
    const seed = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir, backend: 'github', repoIdentity: REPO.refId,
      dbPath: legacyDbPath, now, storageKind: 'local',
    })
    writeRow(seed.handle, 'OLD', '旧版本写的票')
    seed.handle.close()
    // 旧版本（或另一个还没重启的进程）留下的租约：写者标识沿用旧代码的 refresh- 前缀。
    setLeaseRow(legacyDbPath, 'refresh-4321-1', clock + 60000)

    const blocked = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir, backend: 'github', repoIdentity: REPO.refId,
      dbPath: legacyDbPath, now, storageKind: 'local',
    })
    check(blocked.mode === 'writable' && blocked.handle.legacyWriterBlocked === true
      && codeOf(blocked).indexOf('legacy-writer-restart') >= 0,
      'C1 检测到未过期的旧租约：句柄仍是 writable，但标出 legacyWriterBlocked 并留 legacy-writer-restart 诊断',
      { mode: blocked.mode, blocked: blocked.handle.legacyWriterBlocked, codes: codeOf(blocked) })
    const refused = writeRow(blocked.handle, 'NEW', '不该写进去的票')
    const refusedBookkeeping = blocked.handle.writeSyncBookkeeping({ watermarkMs: clock })
    const refusedMissing = blocked.handle.markMissing([{ effortId: '', key: 'OLD' }], blocked.handle.getMergeVersion())
    check(refused.committed === false && refused.reason === 'legacy-writer',
      'C2 旧租约未过期时 ingest 回 legacy-writer（不是 readonly）', refused)
    check(refusedBookkeeping.committed === false && refusedBookkeeping.reason === 'legacy-writer',
      'C3 旧租约未过期时 writeSyncBookkeeping 也回 legacy-writer', refusedBookkeeping)
    check(refusedMissing.committed === false && refusedMissing.reason === 'legacy-writer' && refusedMissing.marked === 0,
      'C4 旧租约未过期时 markMissing 也回 legacy-writer，一行都不标', refusedMissing)
    check(leaseRowOf(legacyDbPath).owner === 'refresh-4321-1',
      'C5 被挡住时不删别人的租约行（那是另一个进程还在用的写权）', leaseRowOf(legacyDbPath))

    // 租约过期：下一次写自动恢复，并把残留的租约行清掉 —— 不要求重启本窗口。
    clock += 61000
    // 先只读一次：设置页读的就是这一格，它必须自己变回 false，不能等某次写才刷新，
    // 否则过期之后设置页还会继续显示「请重启所有窗口」。
    check(blocked.handle.legacyWriterBlocked === false,
      'C6 租约过期后不用写也能看出来不再阻塞（读数现算，不是打开时的缓存）', blocked.handle.legacyWriterBlocked)
    const resumed = writeRow(blocked.handle, 'NEW', '过期之后写进去的票')
    check(resumed.committed === true && blocked.handle.getMergeVersion() === 2,
      'C7 租约过期后同一句柄直接恢复写（不要求重启本窗口）', { resumed, version: blocked.handle.getMergeVersion() })
    const cleared = leaseRowOf(legacyDbPath)
    check(cleared.owner === null && cleared.expires === null,
      'C8 恢复写的同时把残留的租约行清掉', cleared)
    check(blocked.handle.legacyWriterBlocked === false, 'C9 恢复之后 legacyWriterBlocked 仍是 false', blocked.handle.legacyWriterBlocked)
    blocked.handle.close()
  }

  // ── D 网络盘回退：仍是单写者，抢不到就只读 ────────────────────────────────────
  {
    const netDbPath = path.join(tempRoot, 'db', 'network.sqlite')
    const netOpen = () => openWorkspaceSnapshot({
      workspaceRoot: workspaceDir, backend: 'github', repoIdentity: REPO.refId,
      dbPath: netDbPath, now: () => Date.now(), storageKind: 'network',
    })
    const holder = netOpen()
    check(holder.mode === 'writable' && holder.storageKind === 'network' && holder.handle.storageKind === 'network',
      'D1 网络盘：第一个句柄抢到写权、storageKind 是 network',
      { mode: holder.mode, storageKind: holder.storageKind })
    const first = writeRow(holder.handle, 'N1', '网络盘上的票')
    check(first.committed === true, 'D2 网络盘第一个句柄能写', first)

    const contender = netOpen()
    const refused = writeRow(contender.handle, 'N2', '不该写进去的票')
    check(contender.mode === 'readonly' && codeOf(contender).indexOf('lease-held-readonly') >= 0,
      'D3 网络盘第二个句柄抢不到租约：退回只读并带 lease-held-readonly 诊断',
      { mode: contender.mode, codes: codeOf(contender) })
    check(refused.committed === false && refused.reason === 'readonly' && titlesIn(contender.handle).join('') === '网络盘上的票',
      'D4 网络盘只读句柄拒写但仍能读', refused)
    contender.handle.close()

    holder.handle.close()
    const third = netOpen()
    const wrote = writeRow(third.handle, 'N3', '接手之后写的票')
    check(third.mode === 'writable' && wrote.committed === true,
      'D5 第一个句柄关掉并释放租约之后，第三个句柄能接手写',
      { mode: third.mode, wrote })
    third.handle.close()
  }

  // ── E 设置页读数：回包带 storageKind 与 mode，写模型分四档说法 ─────────────────
  {
    const phone = makePhone({
      readLibraryVersion: async () => 7,
      readLibraryChangeSet: async () => null,
      readLibraryStorageStats: async () => ({ version: 7, bytes: 4096, rows: 3, mode: 'writable', storageKind: 'local', legacyWriterBlocked: false }),
    })
    const local = await phone.handleSnapshotStoreStats({ cwd: workspaceDir })
    check(local && local.storageKind === 'local' && local.mode === 'writable' && local.rows === 3,
      'E1 诊断电话回包带 storageKind 与 mode（本地多写者）', local)
    const localReadout = snapshotWriteModelReadoutOf(local)
    check(localReadout.ok === true && localReadout.kind === 'local-multi-writer' && localReadout.copyKey === 'env.diagWriteModel.local',
      'E2 本地多写者这一档给出稳定的档名与文案键', localReadout)

    const phoneNet = makePhone({
      readLibraryVersion: async () => 7,
      readLibraryChangeSet: async () => null,
      readLibraryStorageStats: async () => ({ version: 7, bytes: 4096, rows: 3, mode: 'readonly', storageKind: 'network', legacyWriterBlocked: false }),
    })
    const net = await phoneNet.handleSnapshotStoreStats({ cwd: workspaceDir })
    check(net && net.storageKind === 'network' && net.mode === 'readonly',
      'E3 网络盘回退时回包如实说 network + readonly', net)
    const netReadout = snapshotWriteModelReadoutOf(net)
    check(netReadout.kind === 'network-single-writer-fallback' && netReadout.copyKey === 'env.diagWriteModel.networkFallback',
      'E4 网络回退这一档单独一个说法（与「本窗口持写权」分得开）', netReadout)

    const readOnlyReadout = snapshotWriteModelReadoutOf({ version: 1, bytes: 1, rows: 1, mode: 'readonly', storageKind: 'local' })
    check(readOnlyReadout.kind === 'readonly-filesystem' && readOnlyReadout.copyKey === 'env.diagWriteModel.readonly',
      'E5 本地只读这一档说的是「文件系统不可写」，不再是「另一个窗口拿着租约」', readOnlyReadout)
    const unknown = snapshotWriteModelReadoutOf({ ok: false, error: '库打不开' })
    check(unknown.ok === false && unknown.copyKey === '' && unknown.kind === 'unknown',
      'E6 读不到时不给一个编出来的档位（文案键为空）', unknown)
    // 旧租约挡住本地写的那一档：mode 仍是 writable，但这一行必须说「要重启」，
    // 不能被画成正常的本地多写者（否则用户会以为这一笔写进去了）。
    const legacyReadout = snapshotWriteModelReadoutOf({ version: 3, bytes: 512, rows: 1, mode: 'writable', storageKind: 'local', legacyWriterBlocked: true })
    check(legacyReadout.kind === 'legacy-writer-blocked' && legacyReadout.copyKey === 'env.diagWriteModel.legacy',
      'E9 本地旧租约挡住写时单独一档（文案键指向「请重启所有窗口」）', legacyReadout)

    // 真库：本地句柄的占用读数自带 storageKind。
    const real = openLocal('gate-1932-stats')
    const stats: any = real.handle.readStorageStats()
    check(stats && stats.storageKind === 'local' && stats.rows === 3 && stats.bytes > 0,
      'E7 handle.readStorageStats 也带 storageKind，读数对着真库', stats)
    real.handle.close()
    const viaLib: any = await readLibraryStorageStats({ workspaceRoot: workspaceDir, backend: 'github', repoIdentity: REPO.refId })
    check(viaLib && viaLib.storageKind === 'local' && typeof viaLib.mode === 'string' && viaLib.version >= 0,
      'E8 readLibraryStorageStats 把 storageKind 与 mode 一起交上来', viaLib)
  }

  // ── F 路径判定：UNC 两种写法都算网络盘，盘符路径算本地 ────────────────────────
  {
    check(detectStorageKind('\\\\server\\share\\snap.sqlite') === 'network',
      'F1 \\\\server\\share 形式的 UNC 判成 network')
    check(detectStorageKind('//server/share/snap.sqlite') === 'network',
      'F2 //server/share 形式的 UNC 也判成 network')
    check(detectStorageKind(path.join(tempRoot, 'db', 'local.sqlite'), { platform: 'win32', networkDrivesOf: () => [] }) === 'local',
      'F3 本机盘符路径判成 local（不在网络盘集合里就是本地）')
    check(detectStorageKind('Z:/ws/snap.sqlite', { platform: 'win32', networkDrivesOf: () => ['Z:'] }) === 'network',
      'F4 映射成网络驱动器的盘符（Z:）判成 network')
    check(detectStorageKind(path.join(tempRoot, 'db', 'x.sqlite'), { platform: 'win32', networkDrivesOf: () => { throw new Error('没有 PowerShell') } }) === 'local',
      'F5 查不到网络盘集合时按本地多写者处理（不做「宁可锁成只读」的猜测）')
    check(detectStorageKind('/mnt/nas/snap.sqlite', { platform: 'linux', statfsTypeOf: () => 0x6969 }) === 'network',
      'F6 POSIX：挂载点是 NFS 时判成 network（平台与文件系统读数可注入，门禁不依赖跑在哪种主机上）')
    check(detectStorageKind('/home/me/snap.sqlite', { platform: 'linux', statfsTypeOf: () => 0xef53 }) === 'local',
      'F7 POSIX：ext4 这类本地文件系统判成 local')
  }

  // 缓存句柄（占用的那条读口）关掉再删临时目录：Windows 上还开着的库文件删不掉。
  closeSnapshotLibraries()
  for (let i = 0; i < 3; i += 1) {
    try { rmSync(tempRoot, { recursive: true, force: true }); break } catch (error) {
      if (i === 2) console.log('提示：临时目录没能立刻删掉（Windows 上文件刚关掉时常见）：' + String((error as any) && (error as any).message))
    }
  }
  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 本地多窗口可写门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

if (process.argv.includes('--driver')) {
  driverMain(process.argv.slice(process.argv.indexOf('--driver') + 1)).catch((e) => {
    console.log('DRIVER FAIL ' + ((e && e.stack) || e))
    process.exitCode = 1
  })
} else {
  run().catch((e) => {
    console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
    printGateResult(GATE, total, failed + 1)
    process.exitCode = 1
  })
}
