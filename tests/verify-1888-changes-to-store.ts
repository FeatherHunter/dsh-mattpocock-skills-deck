/**
 * tests/verify-1888-changes-to-store.ts —— 后台发现的变化先写进快照库（#1888，规格 #1885 S3）
 *
 * 守什么（票面五条验收逐条落在这里）：
 *   ① 别人改一张票之后，切会话或重开宿主仍看到新值：行级增量补到的那几行先写进库，
 *      关掉所有库句柄（等价于换会话 / 重启宿主）之后从库回放出来仍是新值；
 *   ② 关库重开后，水印、世代号、待办都还在：三样簿记写进库级元信息，不再只活在进程内存里；
 *   ③ 库写入失败时这一趟按失败处理：内存副本一个字节不改、界面保持旧值；
 *   ④ 迟到的整池结果不会覆盖更新的增量结果：世代号门禁在库这一侧也拦住；
 *   ⑤ 回包形状与改造前一致：行级增量的回包键集与快照里 delta 的键集逐字比对，证明没有顺手改契约。
 *
 * 为什么用真 SQLite 临时库 + 假后端会话：本票要守的正是「写没写进库」这件事。拿内存替身盖住库，
 * 「关库重开后还在」与「写失败时内存不变」这两条都测不出来；而真库也才能验证「行与簿记一个事务」。
 * 假后端只负责给薄查询回包，仓库键与身份由测试直接注入，不碰网络。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1888-changes-to-store.ts
 */
// 门禁归属: src/refresh/rooms/host/row-patch.ts
// 门禁归属: src/refresh/rooms/host/patch-library-ports.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts
// 门禁归属: src/refresh/rooms/host/thin-row-fetch.ts
// 门禁归属: src/workspace-snapshot/runtime/ingest.ts
// 门禁归属: src/workspace-snapshot/runtime/open.ts
// 门禁归属: src/workspace-snapshot/persistence/sync-bookkeeping.ts
// 门禁归属: src/workspace-snapshot/contract/types.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import * as delta from '../src/refresh/kernel/snapshot-diff.ts'
import * as win from '../src/refresh/kernel/index-window-rules.ts'
import { createPatch } from '../src/refresh/rooms/host/row-patch.ts'
import { createPatchLibraryPorts } from '../src/refresh/rooms/host/patch-library-ports.ts'
import {
  closeSnapshotLibraries,
  commitChangeRows,
  readIssueIndex,
  readSnapshotReplay,
  readSyncState,
  recordIssueRows,
  writeSyncState,
} from '../src/refresh/rooms/host/snapshot-library.ts'

const GATE = 'verify-1888-changes-to-store'
let total = 0
let failed = 0
function check(ok: unknown, message: string, detail?: unknown): void {
  total += 1
  if (ok) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

/** 假时钟：行级增量的水印与扫描窗口都按它算，断言才能写死。 */
const CLOCK0 = 1762000000000
let clock = CLOCK0
const NOW = () => clock

const REPO = { backend: 'github', refId: 'acme/widgets', name: 'acme/widgets', url: '' }

/** 假后端那边的一张票（tracker 契约形状，够适配层换算即可）。 */
function issueOf(key: string, state: string, title: string, updatedAt: string): any {
  return {
    key, effortId: '', type: 'issue', title, state, body: '',
    url: 'https://github.com/acme/widgets/issues/' + key,
    createdAt: '2026-09-01T00:00:00Z', updatedAt, closedAt: state === 'closed' ? updatedAt : null,
    parentKey: null, labels: [], assignees: [{ login: 'me' }], blockedBy: [], isPullRequest: false,
  }
}

/** 内存里那一份工作副本（宿主缓存）。行与快照形状照旧，delta 仍是老样子。 */
function memorySnapshot(rows: any[]): any {
  return {
    ok: true,
    repo: { owner: 'acme', name: 'widgets' },
    workspaceRoot: CWD,
    version: 'v0',
    generatedMs: CLOCK0 - 60000,
    maps: [],
    issues: rows,
    labels: [],
    deck: { counts: { open: rows.length, closed: 0, total: rows.length }, partial: false, levels: [] },
    delta: {
      structureVersion: delta.DELTA_STRUCTURE_VERSION,
      watermarkMs: CLOCK0 - 3600000,
      generation: 3,
      pending: [],
      pendingAt: 0,
      pendingReason: '',
    },
  }
}

/** 内存里那一行的形状（与行级增量合并层认的字段一致）。 */
function memoryRow(key: string, state: string, updatedAt: string): any {
  return {
    number: Number(key), key, title: '票 ' + key, state, updatedAt,
    labels: [], assignees: [], createdAt: '2026-09-01T00:00:00Z',
  }
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1888-'))
const CWD = tempRoot
const KEY = { workspaceRoot: tempRoot, backend: 'github', repoIdentity: 'acme/widgets' }

/** 生产里 getSnapshotLibrary() 交回来的就是快照库模块本身；这里原样用它。 */
const libraryModule: any = { readSyncState, writeSyncState, readIssueIndex, commitChangeRows, recordIssueRows, readSnapshotReplay }
function portsWith(overrides?: Record<string, unknown>): any {
  const module = Object.assign({}, libraryModule, overrides || {})
  return createPatchLibraryPorts({
    getSnapshotLibrary: async () => module,
    getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
    backendIdOf: () => 'github',
  })
}

/** 假后端：薄查询按票号回包；可以点名让某几条失败。 */
const gets: string[] = []
const remoteIssues: Record<string, any> = {}
const failedKeys = new Set<string>()
let remoteIndex: Record<string, string> = {}
const session = {
  get: async (_ref: any, key: any) => {
    gets.push(String(key))
    if (failedKeys.has(String(key))) return { ok: false, error: { kind: 'network', message: '模拟取数失败' } }
    const issue = remoteIssues[String(key)]
    if (!issue) return { ok: false, error: { kind: 'not-found', message: '没有这张票' } }
    return {
      ok: true,
      data: issue,
      provenance: {
        operation: 'get', source: 'graphql', completeness: 'complete',
        fieldGroups: {
          row: 'complete', labels: 'complete', parents: 'complete', dependencies: 'complete',
          body: 'unexpressed', comments: 'unexpressed', subIssues: 'unexpressed', review: 'unexpressed', mergeInfo: 'unexpressed',
        },
        missingFieldGroups: [], durationMs: 3, startVersion: 'read-v1-1-000001',
      },
    }
  },
}

/**
 * 造一份行级增量。snapshot 是内存副本的可变盒子（写回会改它）；
 * library 传 null 就走改造前的内存路径（用来对照「没有库时行为不变」）。
 */
function makePatch(options: { snapshot: any; library: any; onWrite?: (snap: any) => void }): any {
  const state: any = { snap: options.snapshot, writes: 0 }
  const patch = createPatch({
    now: NOW,
    logCtx: null,
    workspaceKeyOf: () => 'ws-1888',
    readSnapshot: async () => state.snap,
    writeSnapshot: async (_cwd: any, snap: any) => {
      state.writes += 1
      state.snap = snap
      if (options.onWrite) options.onWrite(snap)
    },
    indexOfSnapshot: win.indexFromSnapshot,
    windowRules: win,
    getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
    probeIndex: async () => ({ ok: true, index: remoteIndex }),
    openSession: async () => ({ ok: true, backendId: 'github', repoRef: REPO, call: (fn: any) => fn(session, {}) }),
    decide: () => ({ verdict: 'send' }),
    ...(options.library ? { library: options.library } : null),
  })
  return { patch, state }
}

async function seedLibrary(): Promise<void> {
  const rows = [
    issueOf('101', 'open', '票 101', '2026-09-20T00:00:00Z'),
    issueOf('102', 'open', '票 102', '2026-09-19T00:00:00Z'),
    issueOf('103', 'open', '票 103', '2026-09-18T00:00:00Z'),
  ]
  const written: any = await recordIssueRows(Object.assign({ rows }, KEY))
  if (!written.ok) throw new Error('种子行没写进库：' + JSON.stringify(written))
  const sync: any = await writeSyncState(KEY, {
    watermarkMs: CLOCK0 - 3600000,
    generation: 3,
    pending: [],
    pendingAtMs: 0,
    pendingReason: '',
  })
  if (!sync || sync.committed !== true) throw new Error('簿记没写进库：' + JSON.stringify(sync))
}

async function main(): Promise<void> {
  mkdirSync(path.join(tempRoot, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(tempRoot, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1888' + String.fromCharCode(10), 'utf8')
  await seedLibrary()

  // ============================================================
  // 一、库级元信息里的同步簿记：读、写、关库重开
  // ============================================================
  {
    const before: any = await readSyncState(KEY)
    check(before !== null && before.state.watermarkMs === CLOCK0 - 3600000 && before.state.generation === 3,
      'A1 库级元信息读得出水印与世代号', before && before.state)
    const written: any = await writeSyncState(KEY, { pending: ['102'], pendingAtMs: 1234, pendingReason: 'thin-query-failed' })
    check(written !== null && written.committed === true, 'A2 待办写进库（一个事务）', written)
    check(written !== null && written.state.pending.length === 1 && written.state.pending[0] === '102',
      'A3 写完回执里就带着新的待办', written && written.state)
    closeSnapshotLibraries()
    const reopened: any = await readSyncState(KEY)
    check(reopened !== null && reopened.state.watermarkMs === CLOCK0 - 3600000 && reopened.state.generation === 3,
      'A4 关库重开后水印与世代号都还在（不再依赖进程内存）', reopened && reopened.state)
    check(reopened !== null && reopened.state.pending[0] === '102' && reopened.state.pendingReason === 'thin-query-failed',
      'A5 关库重开后待办与原因都还在', reopened && reopened.state)
    // 清掉这一组夹具留下的待办，后面几组都从「没待办」起跑。
    await writeSyncState(KEY, { pending: [], pendingAtMs: 0, pendingReason: '' })
  }

  // ============================================================
  // 二、差分基线从库读：库里的行就是基线，内存副本不是
  // ============================================================
  {
    const index: any = await readIssueIndex(KEY)
    check(index !== null && index['101'] === 'OPEN|2026-09-20T00:00:00.000Z' && index['102'] === 'OPEN|2026-09-19T00:00:00.000Z',
      'B1 差分基线读得出库里的三行（票号 → 状态|更新时间）', index)
    // 内存副本里多一条库里没有的 999：拿内存当基线会判成「有票号消失」，拿库当基线只会判 101 变了。
    const snapshot = memorySnapshot([
      memoryRow('101', 'OPEN', '2026-09-20T00:00:00Z'),
      memoryRow('102', 'OPEN', '2026-09-19T00:00:00Z'),
      memoryRow('103', 'OPEN', '2026-09-18T00:00:00Z'),
      memoryRow('999', 'OPEN', '2026-09-17T00:00:00Z'),
    ])
    remoteIssues['101'] = issueOf('101', 'closed', '票 101', '2026-09-23T00:00:00Z')
    remoteIndex = {
      '101': 'CLOSED|2026-09-23T00:00:00Z',
      '102': 'OPEN|2026-09-19T00:00:00.000Z',
      '103': 'OPEN|2026-09-18T00:00:00.000Z',
    }
    const made = makePatch({ snapshot, library: portsWith() })
    const result: any = await made.patch.run(CWD)
    check(result.mode === 'patch' && result.rows.length === 1 && result.rows[0] === '101',
      'B2 基线来自库：内存多出来的 999 不会把它判成「票号消失」而整池', result)
    check(gets.length === 1 && gets[0] === '101', 'B3 只补了变的那一条薄查询', gets)
    check(result.generation === 4 && result.watermarkMs === CLOCK0,
      'B4 世代号从库里的 3 推到 4，水印推到本次扫描起点', result)
    const shape = Object.keys(result).sort().join(',')
    check(shape === 'counts,generation,mergeVersion,mode,partial,pending,queries,reason,rows,version,watermarkMs',
      'B5 行级增量的回包键集与改造前逐字相同（没有顺手改契约）', shape)
  }

  // ============================================================
  // 三、别人改了票：切会话 / 重开宿主之后仍看到新值
  // ============================================================
  {
    closeSnapshotLibraries()
    const replay: any = await readSnapshotReplay(Object.assign({ repo: REPO }, KEY))
    const rows: any[] = replay ? [].concat(replay.snapshot.issues || []) : []
    const row101 = rows.filter((r: any) => String(r.number) === '101')[0]
    check(!!row101 && String(row101.state).toUpperCase() === 'CLOSED', 'C1 关库重开之后，从库回放出来的 101 已是关闭（新值）', row101 && row101.state)
    check(!!row101 && String(row101.title) === '票 101', 'C2 回放的那一行其余字段照旧', row101 && row101.title)
    const state: any = await readSyncState(KEY)
    check(state !== null && state.state.generation === 4 && state.state.watermarkMs === CLOCK0,
      'C3 关库重开后水印与世代号是这一趟写下的值', state && state.state)
  }

  // ============================================================
  // 四、库写入失败：这一趟按失败处理，内存副本一个字节不改
  // ============================================================
  {
    const snapshot = memorySnapshot([
      memoryRow('101', 'OPEN', '2026-09-20T00:00:00Z'),
      memoryRow('102', 'OPEN', '2026-09-19T00:00:00Z'),
      memoryRow('103', 'OPEN', '2026-09-18T00:00:00Z'),
    ])
    const before = snapshot.issues[0]
    remoteIssues['101'] = issueOf('101', 'closed', '票 101', '2026-09-24T00:00:00Z')
    remoteIndex = { '101': 'CLOSED|2026-09-24T00:00:00.000Z', '102': 'OPEN|2026-09-19T00:00:00.000Z', '103': 'OPEN|2026-09-18T00:00:00.000Z' }
    const failing = portsWith({ commitChangeRows: async () => ({ ok: false, rows: 0, mergeVersion: null, reason: 'readonly' }) })
    let writes = 0
    const made = makePatch({ snapshot, library: failing, onWrite: () => { writes += 1 } })
    const result: any = await made.patch.run(CWD)
    check(result.mode === 'failed' && String(result.reason).indexOf('store') >= 0,
      'D1 库写入失败时这一趟如实失败（不假装补过）', result)
    check(writes === 0, 'D2 内存副本一次都没写（界面保持旧值）', writes)
    check(snapshot.issues[0] === before && snapshot.issues[0].state === 'OPEN',
      'D3 库写失败时那一行仍是旧值', snapshot.issues[0] && snapshot.issues[0].state)
  }

  // ============================================================
  // 五、世代号门禁：迟到的整池结果不许覆盖更新的增量结果
  // ============================================================
  {
    const snapshot = memorySnapshot([
      memoryRow('101', 'CLOSED', '2026-09-23T00:00:00Z'),
      memoryRow('102', 'OPEN', '2026-09-19T00:00:00Z'),
      memoryRow('103', 'OPEN', '2026-09-18T00:00:00Z'),
    ])
    const made = makePatch({ snapshot, library: portsWith() })
    const current: any = await readSyncState(KEY)
    check(current !== null && current.state.generation === 4, 'E1 开跑前库里的世代号是 4', current && current.state)
    const late = Object.assign({}, snapshot, { version: 'from-late-rebuild' })
    const rejected: any = await made.patch.admitSnapshot(CWD, late, 3)
    check(rejected.accepted === false && rejected.reason === 'stale-result', 'E2 落后世代发起的整池结果被丢掉', rejected)
    check(made.state.snap.version === 'v0' && made.state.snap.issues[0].state === 'CLOSED',
      'E3 面板上仍是增量结果，没被迟到的整池顶掉', { version: made.state.snap.version, state: made.state.snap.issues[0].state })
    const accepted: any = await made.patch.admitSnapshot(CWD, Object.assign({}, snapshot, { version: 'v-fresh' }), 4)
    check(accepted.accepted === true && accepted.generation === 5, 'E4 同一世代发起的整池结果照收，世代号推一格', accepted)
    check(made.state.snap.version === 'v-fresh', 'E5 收下之后内存副本换成整池那一份', made.state.snap.version)
    closeSnapshotLibraries()
    const after: any = await readSyncState(KEY)
    check(after !== null && after.state.generation === 5, 'E6 收下之后的世代号写进了库（关库重开仍在）', after && after.state)
    const stale: any = await commitChangeRows(Object.assign({ rows: [], startMergeVersion: after.mergeVersion, sync: { generation: 9, expectedGeneration: 4 } }, KEY))
    check(stale.ok === false && stale.reason === 'stale', 'E7 库里那一侧同样拦：期望世代对不上时整批不写', stale)
    const afterStale: any = await readSyncState(KEY)
    check(afterStale !== null && afterStale.state.generation === 5, 'E8 被拦下时库里的世代号一个字节没动', afterStale && afterStale.state)
  }

  // ============================================================
  // 六、待办进库：取数失败时水印不动、待办留下，关库重开还在
  // ============================================================
  {
    const snapshot = memorySnapshot([
      memoryRow('101', 'CLOSED', '2026-09-23T00:00:00Z'),
      memoryRow('102', 'OPEN', '2026-09-19T00:00:00Z'),
      memoryRow('103', 'OPEN', '2026-09-18T00:00:00Z'),
    ])
    remoteIssues['102'] = issueOf('102', 'closed', '票 102', '2026-09-25T00:00:00Z')
    remoteIndex = { '101': 'CLOSED|2026-09-23T00:00:00.000Z', '102': 'CLOSED|2026-09-25T00:00:00.000Z', '103': 'OPEN|2026-09-18T00:00:00.000Z' }
    failedKeys.add('102')
    const made = makePatch({ snapshot, library: portsWith() })
    const watermarkBefore: number = (await readSyncState(KEY))!.state.watermarkMs
    const result: any = await made.patch.run(CWD)
    check(result.mode === 'failed', 'F1 取数失败时这一趟如实失败', result)
    const pendingState: any = await readSyncState(KEY)
    check(pendingState !== null && pendingState.state.pending.length === 1 && pendingState.state.pending[0] === '102',
      'F2 变化进了库里的待办', pendingState && pendingState.state)
    check(pendingState !== null && pendingState.state.watermarkMs === watermarkBefore,
      'F3 水印一个字节都没动（那条变化没掉出窗口）', pendingState && pendingState.state)
    check(made.state.snap.issues[1].state === 'OPEN', 'F4 没取到的那一行没有被并进列表（界面还是旧的）', made.state.snap.issues[1].state)
    closeSnapshotLibraries()
    const reopened: any = await readSyncState(KEY)
    check(reopened !== null && reopened.state.pending[0] === '102', 'F5 关库重开后待办还在', reopened && reopened.state)
    // 下一轮恢复了：同一条变化仍然被发现、补上之后待办清空。
    clock += 60000
    failedKeys.delete('102')
    const made2 = makePatch({ snapshot: made.state.snap, library: portsWith() })
    const recovered: any = await made2.patch.run(CWD)
    check(recovered.mode === 'patch' && recovered.rows[0] === '102', 'F6 下一次仍然发现了同一条变化并补上了它', recovered)
    const cleared: any = await readSyncState(KEY)
    check(cleared !== null && cleared.state.pending.length === 0, 'F7 补上之后库里的待办清空', cleared && cleared.state)
    // 切进工作区：有待办就整池并清待办（簿记在库里，进程内存清空也一样）。
    await writeSyncState(KEY, { pending: ['103'], pendingAtMs: clock, pendingReason: 'merge-missing' })
    closeSnapshotLibraries()
    const made3 = makePatch({ snapshot: made.state.snap, library: portsWith() })
    const entered: any = await made3.patch.enterWorkspace(CWD)
    check(entered.mode === 'rebuild' && entered.reason === 'pending-todo', 'F8 切进工作区：库里有待办就整池', entered)
    const afterEnter: any = await readSyncState(KEY)
    check(afterEnter !== null && afterEnter.state.pending.length === 0, 'F9 整池之前把库里的待办清掉', afterEnter && afterEnter.state)
  }

  // ============================================================
  // 七、没有接库时行为不变（旧门禁的假世界仍走内存那一份）
  // ============================================================
  {
    const snapshot = memorySnapshot([
      memoryRow('101', 'OPEN', '2026-09-20T00:00:00.000Z'),
      memoryRow('102', 'OPEN', '2026-09-19T00:00:00.000Z'),
      memoryRow('103', 'OPEN', '2026-09-18T00:00:00.000Z'),
    ])
    remoteIssues['101'] = issueOf('101', 'closed', '票 101', '2026-09-23T00:00:00Z')
    remoteIndex = { '101': 'CLOSED|2026-09-23T00:00:00.000Z', '102': 'OPEN|2026-09-19T00:00:00.000Z', '103': 'OPEN|2026-09-18T00:00:00.000Z' }
    const made = makePatch({ snapshot, library: null })
    const result: any = await made.patch.run(CWD)
    check(result.mode === 'patch', 'G1 没接库时行级增量照常补行', result)
    check(made.state.snap.delta && made.state.snap.delta.generation === 4 && made.state.snap.delta.watermarkMs === clock,
      'G2 没接库时簿记仍写在内存快照的 delta 上（旧行为不变）', made.state.snap.delta)
    const shape = Object.keys(made.state.snap.delta).sort().join(',')
    check(shape === 'generation,pending,pendingAt,pendingReason,structureVersion,watermarkMs',
      'G3 快照 delta 的键集与改造前逐字相同', shape)
  }

  console.log('')
  console.log(failed === 0 ? '全部通过（' + total + ' 项）' : ('失败 ' + failed + ' / ' + total + ' 项'))
  printGateResult(GATE, total, failed)
}

try {
  await main()
} catch (e: any) {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  failed += 1
} finally {
  try { closeSnapshotLibraries() } catch { /* 句柄已经关了 */ }
  rmSync(tempRoot, { recursive: true, force: true })
}
process.exit(failed === 0 ? 0 : 1)
