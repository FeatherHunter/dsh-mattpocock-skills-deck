/**
 * tests/verify-1890-read-channels.ts —— 宿主新增版本查询与变化集两条读口（#1890，规格 #1885 S4）
 *
 * 守什么（票面六条验收逐条落在这里）：
 *   A 版本查询：回包只有版本、工作区键、后端三格（键集断言），版本与库里的合并版本一致；
 *   B 变化集：从某个版本到现在，变化的行与被判不存在的墓碑都在，条数与库里实际变化一致；
 *   C 行数上限：变化行与墓碑加起来超过上限时回「整份」（full 为真，不给截断的变化集）；
 *   D 时间上限：客户端手上的版本太旧时回「整份」；
 *   E 版本回退：客户端传来的版本比库里当前版本大时回「整份」；
 *   F 旧路径不变：wf.snapshot 回放出来的快照仍只有原来那些顶层字段，wf.probe 的补丁回包键集逐字不变；
 *   G 界面上看得到当前库版本：环境检查页的诊断读数调 wf.snapshotVersion，把回的版本显示出来，
 *     并与快照库里的版本一致。
 *
 * 为什么用真 SQLite 临时库 + 假后端：这两条读口守的是「库里的版本与变化集」，
 * 内存替身盖住库就验不出「关库重开、版本从库里读、墓碑进变化集」这三件事；
 * 假后端只负责认出工作区与仓库身份，两条电话都不联网。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1890-read-channels.ts
 */
// 门禁归属: src/refresh/rooms/host/snapshot-read-channels.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-read.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts
// 门禁归属: src/workspace-snapshot/projection/changes.ts
// 门禁归属: src/workspace-snapshot/projection/list.ts
// 门禁归属: src/workspace-snapshot/runtime/open.ts
// 门禁归属: src/workspace-snapshot/contract/types.ts
// 门禁归属: src/client/views/ChecksTab.ts
// 门禁归属: src/client/views/shared/truthLines.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import type { WorkspaceSnapshotHandle } from '../src/workspace-snapshot/contract/types.ts'
import { issueWritesOf } from '../src/refresh/rooms/host/snapshot-library-adapter.ts'
import {
  closeSnapshotLibraries,
  readLibraryChangeSet,
  readLibraryVersion,
  readSnapshotReplay,
} from '../src/refresh/rooms/host/snapshot-library.ts'
import { createSnapshotReadChannels } from '../src/refresh/rooms/host/snapshot-read-channels.ts'
import { createSessionSnapshot } from '../src/refresh/rooms/host/session-snapshot-cache.ts'
import { createProbeHandler } from '../src/refresh/rooms/host/probe-handler.ts'
import { snapshotFieldViolations } from '../src/host/snapshotEnvelope.ts'
import { snapshotVersionReadoutOf } from '../src/client/views/shared/truthLines.ts'
import { SNAPSHOT_CHANGES_MAX_AGE_MS, SNAPSHOT_CHANGES_MAX_ROWS } from '../src/shared/time-config/src/values.js'

const GATE = 'verify-1890-read-channels'
const REPO: RepositoryRef = {
  backend: 'github',
  refId: 'acme/widgets',
  name: 'acme/widgets',
  url: 'https://github.com/acme/widgets',
}
// 用真实当前时刻：宿主电话自己开的库句柄按 Date.now() 判「落后多久」，
// 假时钟写死成一年前会把每一条变化集都判成 age-over-limit（那不是被测代码的错）。
const NOW0 = Date.now()
let clock = NOW0
const NOW = (): number => clock

let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

function issueOf(key: string, title: string, updatedAt = '2026-11-01T00:00:00Z'): Issue {
  return {
    key,
    effortId: '',
    type: 'issue',
    title,
    state: 'open',
    body: '',
    url: 'https://github.com/acme/widgets/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt,
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [{ login: 'alice' }],
    blockedBy: [],
    isPullRequest: false,
  }
}

/** 开一个真库句柄，写一点东西再关掉；测试只经公开句柄改库，不直接写 SQL。 */
function withHandle<T>(root: string, fn: (handle: WorkspaceSnapshotHandle) => T): T {
  // 宿主电话会把库句柄缓存住（租约跟着它）；这里要改库，先把缓存句柄关掉，否则新句柄只能只读。
  closeSnapshotLibraries()
  const opened = openWorkspaceSnapshot({
    workspaceRoot: root,
    backend: 'github',
    repoIdentity: REPO.refId,
    now: NOW,
    leaseOwner: 'gate-1890-' + Math.random().toString(36).slice(2, 10),
  })
  try {
    return fn(opened.handle)
  } finally {
    try { opened.handle.close() } catch { /* 已关 */ }
  }
}

function writeRows(handle: WorkspaceSnapshotHandle, rows: Issue[]): number {
  const result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes: issueWritesOf(rows, 'github') })
  if (!result.committed) throw new Error('写库失败：' + String(result.reason))
  return result.mergeVersion
}

function libModule(): any {
  return {
    readLibraryVersion,
    readLibraryChangeSet,
    readSnapshotReplay,
    // 首屏助手要求这条写口存在才认这个库门面（有回放时根本不会调到它）；这里给一个不回写的最小实现。
    recordIssueRows: async () => ({ ok: true, rows: 0, mergeVersion: null }),
  }
}

function makePhone(root: string): any {
  return createSnapshotReadChannels({
    canonicalKey: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'github', rev: 1 }),
    isComposerSelection: () => false,
    getTrackerRegistry: async () => ({
      describe: () => REPO,
      modules: () => [],
      get: () => ({}),
    }),
    getSnapshotLibrary: async () => libModule(),
    getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
    openSession: async () => null,
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    now: NOW,
  })
}

function upcaseSnapStates(snap: any): any {
  const up = (row: any): any => { if (row && row.state) row.state = String(row.state).toUpperCase(); return row }
  ;(snap.maps || []).forEach((m: any) => { up(m); (m.tickets || []).forEach(up) })
  ;(snap.issues || []).forEach(up)
  return snap
}

/** 宿主快照电话的假依赖：与 tests/verify-1863-snapshot-cold-start.ts 同一套装配，库是真的。 */
function snapshotPhoneFor(root: string): any {
  const memoryCache = new Map<string, any>()
  let adopted: any = null
  const reg = { describe: () => REPO, modules: () => [], get: () => ({ getCurrentUser: async () => ({ ok: false }) }) }
  const phone = createSessionSnapshot({
    canonicalKey: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'github', rev: 1 }),
    isComposerSelection: () => false,
    getTrackerRegistry: async () => reg,
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    getCache: (c: string) => memoryCache.get(c) || { ts: 0, snapshot: null },
    setCache: (v: any) => { memoryCache.set(v.cwd, { ts: v.ts, snapshot: v.snapshot }) },
    CACHE_MS: 60000,
    upcaseSnapStates,
    computeLevels: () => ({ byNumber: {}, byKey: {} }),
    groupTickets: (tickets: any[]) => ({ total: tickets.length, open: tickets.filter((t) => t.state !== 'CLOSED').length, closed: tickets.filter((t) => t.state === 'CLOSED').length, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
    getRepoRoot: async () => root,
    getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
    adoptSnapshot: (snap: any) => { adopted = snap; return snap },
    detectionExec: () => { throw new Error('门禁不该发命令') },
    getGhPath: () => null,
    getGhLastError: () => null,
    errText: (e: any) => String((e && e.message) || e),
    getSnapshotLibrary: async () => libModule(),
  } as any)
  return { phone, adopted: () => adopted }
}

function sourceOf(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1890-'))
  try {
    mkdirSync(path.join(tempRoot, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1890' + String.fromCharCode(10), 'utf8')
    const phone = makePhone(tempRoot)

    // ============================================================
    // 一、版本查询：只回三格，版本与库一致
    // ============================================================
    let v0 = 0
    withHandle(tempRoot, (handle) => {
      v0 = writeRows(handle, [issueOf('101', '票 101'), issueOf('102', '票 102'), issueOf('103', '票 103')])
    })
    let versionReply: any = await phone.handleSnapshotVersion({ cwd: tempRoot })
    check(versionReply && Object.keys(versionReply).sort().join(',') === 'backend,version,workspaceKey',
      'A1 版本查询回包只有版本、工作区键、后端三格（键集断言）', versionReply && Object.keys(versionReply).sort())
    check(versionReply && versionReply.version === v0 && v0 > 0,
      'A2 版本查询回的版本就是库里的合并版本', versionReply && { got: versionReply.version, want: v0 })
    check(versionReply && versionReply.workspaceKey === tempRoot,
      'A3 工作区键是归一到工作区根之后的路径（与快照回包的 workspaceRoot 同一把钥匙）', versionReply && { got: versionReply.workspaceKey, want: tempRoot })
    check(versionReply && versionReply.backend === 'github', 'A4 后端就是这一轮选中的后端', versionReply && versionReply.backend)
    const replayAfterSeed = await readSnapshotReplay(Object.assign({ repo: REPO }, { workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId }))
    check(replayAfterSeed !== null && versionReply.version === replayAfterSeed.mergeVersion,
      'A5 版本查询与快照回放读的是同一个库版本', { phone: versionReply.version, replay: replayAfterSeed && replayAfterSeed.mergeVersion })

    // ============================================================
    // 二、变化集：变化的行与墓碑行，条数与库里实际变化一致
    // ============================================================
    let emptyReply: any = await phone.handleSnapshotChanges({ cwd: tempRoot, sinceVersion: v0, sinceMs: clock })
    check(emptyReply && emptyReply.full === false && Array.isArray(emptyReply.changed) && emptyReply.changed.length === 0,
      'B1 没有新变化时回空变化集（不是整份）', emptyReply)
    check(emptyReply && Array.isArray(emptyReply.missing) && emptyReply.missing.length === 0,
      'B2 没有墓碑时 missing 是空数组', emptyReply && emptyReply.missing)
    check(emptyReply && emptyReply.version === v0 && emptyReply.workspaceKey === tempRoot && emptyReply.backend === 'github',
      'B3 变化集回包带着版本、工作区键与后端', emptyReply)

    let v1 = 0
    withHandle(tempRoot, (handle) => {
      writeRows(handle, [issueOf('101', '票 101（改过）', '2026-11-02T00:00:00Z'), issueOf('104', '票 104')])
      const marked = handle.markMissing([{ effortId: '', key: '103' }], handle.getMergeVersion())
      if (!marked.committed) throw new Error('墓碑没写进去：' + String(marked.reason))
      v1 = handle.getMergeVersion()
    })
    const changedReply: any = await phone.handleSnapshotChanges({ cwd: tempRoot, sinceVersion: v0, sinceMs: clock })
    check(changedReply && changedReply.full === false, 'B4 变化不多时回变化集', changedReply && changedReply.full)
    check(changedReply && changedReply.version === v1, 'B5 变化集的版本是库里的当前版本', { got: changedReply && changedReply.version, want: v1 })
    const changedKeys: string[] = changedReply && Array.isArray(changedReply.changed) ? changedReply.changed.map((r: any) => String(r.key)).sort() : []
    check(changedKeys.join(',') === '101,104', 'B6 变化的行正好是改过的 101 与新出现的 104', changedKeys)
    const row101 = changedReply && changedReply.changed.filter((r: any) => String(r.key) === '101')[0]
    check(!!row101 && row101.row && row101.row.title === '票 101（改过）', 'B7 变化集交回的是变化之后的行值', row101 && row101.row && row101.row.title)
    const missingKeys: string[] = changedReply && Array.isArray(changedReply.missing) ? changedReply.missing.map((r: any) => String(r.key)) : []
    check(missingKeys.join(',') === '103', 'B8 墓碑行正好是被判不存在的 103', missingKeys)
    const tomb = changedReply && changedReply.missing[0]
    check(!!tomb && tomb.effortId === '' && tomb.deletedAtMs === NOW0,
      'B9 墓碑行带身份与删除时刻', tomb)
    const changedKeysWithTomb: string[] = changedReply && Array.isArray(changedReply.changed) ? changedReply.changed.map((r: any) => String(r.key)) : []
    check(changedKeysWithTomb.indexOf('103') < 0, 'B10 墓碑行不出现在变化的行里（两类各说各的）')
    check(changedReply && changedReply.changed.length + changedReply.missing.length === 3,
      'B11 变化集条数与库里实际变化一致（两行变化 + 一条墓碑）', changedReply && { changed: changedReply.changed.length, missing: changedReply.missing.length })
    const keysOfReply = Object.keys(changedReply || {}).sort().join(',')
    check(keysOfReply === 'backend,changed,full,missing,version,workspaceKey',
      'B12 变化集回包的键集只有约定的那几格', keysOfReply)

    // ============================================================
    // 三、行数上限：超过就回「整份」，不给截断的变化集
    // ============================================================
    const many: Issue[] = []
    for (let i = 0; i < SNAPSHOT_CHANGES_MAX_ROWS + 1; i += 1) many.push(issueOf(String(1000 + i), '批量票 ' + i))
    let vMany = 0
    withHandle(tempRoot, (handle) => { vMany = writeRows(handle, many) })
    const tooManyReply: any = await phone.handleSnapshotChanges({ cwd: tempRoot, sinceVersion: v0, sinceMs: clock })
    check(tooManyReply && tooManyReply.full === true && tooManyReply.reason === 'rows-over-limit',
      'C1 变化行超过行数上限时回整份（reason=rows-over-limit）', tooManyReply)
    check(tooManyReply && !('changed' in tooManyReply) && !('missing' in tooManyReply),
      'C2 回整份时不带一份截断的变化集（changed / missing 两个键都不出现）', Object.keys(tooManyReply || {}).sort())
    check(tooManyReply && tooManyReply.version === vMany && tooManyReply.workspaceKey === tempRoot,
      'C3 整份回包仍带着当前版本与工作区键', tooManyReply)
    const fullKeys = Object.keys(tooManyReply || {}).sort().join(',')
    check(fullKeys === 'backend,full,reason,version,workspaceKey', 'C4 整份回包的键集只有约定的那几格', fullKeys)

    // ============================================================
    // 四、时间上限：客户端手上的版本太旧时回「整份」
    // ============================================================
    withHandle(tempRoot, (handle) => { writeRows(handle, [issueOf('2001', '很晚才出现的一张票')]) })
    const staleReply: any = await phone.handleSnapshotChanges({
      cwd: tempRoot,
      sinceVersion: vMany,
      sinceMs: clock - SNAPSHOT_CHANGES_MAX_AGE_MS - 1,
    })
    check(staleReply && staleReply.full === true && staleReply.reason === 'age-over-limit',
      'D1 落后超过时间上限时回整份（reason=age-over-limit）', staleReply)
    check(staleReply && !('changed' in staleReply) && !('missing' in staleReply), 'D2 这一档同样不给截断的变化集')
    const freshReply: any = await phone.handleSnapshotChanges({ cwd: tempRoot, sinceVersion: vMany, sinceMs: clock })
    check(freshReply && freshReply.full === false && freshReply.changed.length === 1 && String(freshReply.changed[0].key) === '2001',
      'D3 时间没过线时照常回这一条变化（上限不是常驻的）', freshReply && freshReply.changed && freshReply.changed.map((r: any) => r.key))

    // ============================================================
    // 五、版本回退：客户端传来的版本比库里大时回「整份」
    // ============================================================
    const current: any = await phone.handleSnapshotVersion({ cwd: tempRoot })
    const regressed: any = await phone.handleSnapshotChanges({ cwd: tempRoot, sinceVersion: current.version + 1, sinceMs: clock })
    check(regressed && regressed.full === true && regressed.reason === 'version-regressed',
      'E1 客户端版本比库里大（文件被旧拷贝覆盖或库重建）时回整份', regressed)
    check(regressed && !('changed' in regressed) && !('missing' in regressed), 'E2 版本回退时同样不给变化集')
    const noBaseline: any = await phone.handleSnapshotChanges({ cwd: tempRoot, sinceMs: clock })
    check(noBaseline && noBaseline.full === true && noBaseline.reason === 'no-baseline',
      'E3 客户端没带版本（没有基线）时也回整份，不猜一个 0', noBaseline)

    // ============================================================
    // 六、旧路径不变：wf.snapshot 的顶层字段与 wf.probe 的补丁回包键集
    // ============================================================
    const snapMade = snapshotPhoneFor(tempRoot)
    const snapshotReply: any = await snapMade.phone.handleSnapshot({ cwd: tempRoot, backendId: 'github' })
    const snap: any = snapMade.adopted() || (snapshotReply && snapshotReply.snapshot)
    check(snapshotReply && snapshotReply.ok === true, 'F1 快照电话仍成功（旧路径照常工作）', snapshotReply)
    check(!!snap && snap.fromCache === true && !!snap.diskReplay, 'F2 快照仍从库里回放，并带 diskReplay 注记')
    check(!!snap && snapshotFieldViolations(snap).length === 0,
      'F3 快照顶层字段仍在原来的白名单里（没有趁这次加字段）', snap && snapshotFieldViolations(snap))
    const snapKeys = Object.keys(snap || {}).sort().join(',')
    check(snapKeys === 'backendModules,capabilities,deck,diskReplay,env,fallback,fallbackAt,fallbackReason,fromCache,generatedMs,issues,labels,maps,ok,refresh,repo,repoRoot,repository,selection,setupLayout,thinTickets,updatedAt,viewer,viewerLogin,workspaceRoot',
      'F4 快照回包的顶层键集与改造前逐字相同', snapKeys)
    const probe = createProbeHandler({
      canonicalKey: async (c: unknown) => String(c),
      takeWritePatch: async () => ({ snapshot: { marker: 'patch' }, rows: ['105'], version: 'v-patch', at: NOW0, queries: 1, partial: false }),
      noteRefreshFailure: null,
    } as any)
    const probeReply: any = await probe.handleProbe({ cwd: 'D:/ws-1890' })
    const probeKeys = Object.keys(probeReply || {}).sort().join(',')
    check(probeKeys === 'changed,mode,ok,partial,queries,rows,since,snapshot,version',
      'F5 探针的补丁回包键集与改造前逐字相同', probeKeys)

    // ============================================================
    // 七、界面上看得到当前库版本：诊断读数与快照库的版本一致
    // ============================================================
    const liveVersion: any = await phone.handleSnapshotVersion({ cwd: tempRoot })
    const readout: any = snapshotVersionReadoutOf(liveVersion)
    check(readout && readout.ok === true && readout.version === liveVersion.version,
      'G1 诊断读数把版本查询的版本号读出来', readout)
    check(readout && readout.text === String(liveVersion.version),
      'G2 诊断读数显示的就是这个版本号', readout && readout.text)
    const replayForUi = await readSnapshotReplay(Object.assign({ repo: REPO }, { workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId }))
    check(replayForUi !== null && readout.version === replayForUi.mergeVersion,
      'G3 界面显示的版本与快照库当前版本一致（同一份库）', { readout: readout.version, library: replayForUi && replayForUi.mergeVersion })
    const emptyReadout: any = snapshotVersionReadoutOf({ ok: false, error: '库打不开' })
    check(emptyReadout && emptyReadout.ok === false && emptyReadout.text === '—',
      'G4 版本读不到时诊断读数如实写「—」，不编一个 0', emptyReadout)
    const checksSrc = sourceOf('src/client/views/ChecksTab.ts')
    check(checksSrc.indexOf("wf.snapshotVersion") >= 0, 'G5 环境检查页的诊断读数真的调这条读口')
    check(checksSrc.indexOf('env.diagLibraryVersion') >= 0, 'G6 诊断读数有一行「本地数据版本」的文案键')
    check(checksSrc.indexOf('snapshotVersionReadoutOf') >= 0, 'G7 诊断读数用的是同一个读数函数（不在页面里另算一套）')
    const copySrc = sourceOf('config/copy/panel.yaml')
    check(copySrc.indexOf('env.diagLibraryVersion') >= 0, 'G8 文案键在中英词表里都有（panel.yaml）')
    const hostSrc = sourceOf('src/host/index.ts')
    check(hostSrc.indexOf("'wf.snapshotVersion'") >= 0 && hostSrc.indexOf("'wf.snapshotChanges'") >= 0
      && hostSrc.indexOf('snapshot-read-channels.js') >= 0,
      'G9 宿主入口注册了这两条电话，并把它们接进同一个读口模块')
  } finally {
    closeSnapshotLibraries()
    rmSync(tempRoot, { recursive: true, force: true })
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
}
process.exit(failed === 0 ? 0 : 1)
