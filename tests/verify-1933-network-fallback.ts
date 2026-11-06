/**
 * tests/verify-1933-network-fallback.ts —— 网络盘 / UNC 单写者回退与设置页诊断（#1933，规格 #1930）
 *
 * 守什么（票面验收逐条落在这里）：
 *   A 路径判定：UNC（\\\\ 与 //server/share 两种写法）判成 network；本地临时目录判成 local；
 *     开库选项里的 storageKind 覆盖生效（两条路都能强制指定）。
 *   B 网络盘回退：storageKind:'network' 的第一个句柄可写并写下租约；第二个句柄抢不到就退回只读
 *     （lease-held-readonly），只读句柄仍能读；第一个关掉释放租约后，第三个句柄能接手写。
 *   C 本地盘：同一份库上两个句柄都可写，两笔都落库（与 #1932 同一判据，这里只抽一条）。
 *   D 设置页诊断：readLibraryStorageStats / wf.snapshotStoreStats 回包带 storageKind / mode /
 *     legacyWriterBlocked；snapshotWriteModelReadoutOf 的五档各给一个稳定的文案键；
 *     config/copy/panel.yaml 里六个词条中英各一份，中文句子与规格一致；ChecksTab 把这一行画出来。
 *   E 列表：lease-held-readonly / lease-lost-readonly 不再产生列表状态行（#1928 之后）；
 *     损坏重建仍要说 —— 负例旁边留一个正例，证明这段判据不是「什么都不说」。
 *   F 保留项：schema 里三个租约列还在，两个租约时长配置与生成常量还在（网络回退还要用它们）。
 *   G 文档：快照库 README 的写模型一节写明「回退原因只在设置页与日志」「升级要重启所有窗口」。
 *
 * 为什么用真 SQLite：B 段回答的是「两个进程同时打开同一份库，第二个会不会被降级且仍能读」，
 * 内存替身盖住库就只验了替身。A 段与 D 段的文案/接线是结构断言，不需要浏览器。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1933-network-fallback.ts
 */
// 门禁归属: src/workspace-snapshot/runtime/storage-kind.ts
// 门禁归属: src/workspace-snapshot/runtime/open.ts
// 门禁归属: src/workspace-snapshot/runtime/lease.ts
// 门禁归属: src/workspace-snapshot/persistence/schema.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-read.ts
// 门禁归属: src/refresh/rooms/host/snapshot-read-channels.ts
// 门禁归属: src/client/views/shared/truthLines.ts
// 门禁归属: src/client/views/ChecksTab.ts
// 门禁归属: config/copy/panel.yaml
// 门禁归属: config/ttl.yaml
// 门禁归属: config/intervals.yaml
// 门禁归属: src/workspace-snapshot/README.md

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import { detectStorageKind } from '../src/workspace-snapshot/runtime/storage-kind.ts'
import { readLibraryStorageStats } from '../src/refresh/rooms/host/snapshot-library-read.ts'
import { closeSnapshotLibraries } from '../src/refresh/rooms/host/snapshot-library.ts'
import { createSnapshotReadChannels } from '../src/refresh/rooms/host/snapshot-read-channels.ts'
import { issueWritesOf } from '../src/refresh/rooms/host/snapshot-library-adapter.ts'
import { snapshotWriteModelReadoutOf, truthNoticeLines } from '../src/client/views/shared/truthLines.ts'
import { SNAPSHOT_LEASE_HEARTBEAT_MS, SNAPSHOT_LEASE_TTL_MS } from '../src/shared/time-config/values.js'
import type { WorkspaceSnapshotHandle } from '../src/workspace-snapshot/contract/types.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'

const GATE = 'verify-1933-network-fallback'
const ROOT = process.cwd()
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

function srcText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
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

function titlesIn(handle: WorkspaceSnapshotHandle): string[] {
  return handle.readList({ state: 'all' }).issues.map((item: any) => String(item.row.title || '')).sort()
}

/** 读 meta 的租约三格：网络盘回退靠它们工作，本票不许删。 */
function leaseRowOf(dbPath: string): { owner: string | null, heartbeat: number | null, expires: number | null } {
  // 这里直接查库而不是用句柄：要证的是「租约列真的在用」，不是句柄记得什么。
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

/**
 * 取 config/copy/panel.yaml 里某一门语言段下的词条（只读本票这六个键）。
 * 不引生成器：门禁要验的是「YAML 真源里有这些句子」，生成物由编排者跑生成器刷新，
 * 这里读生成物会把两件事混在一起。
 */
function copySectionOf(yamlText: string, lang: string): Record<string, string> {
  const out: Record<string, string> = {}
  let inside = false
  for (const raw of String(yamlText).split(/\r?\n/)) {
    const top = /^([A-Za-z0-9_-]+):\s*$/.exec(raw)
    if (top) { inside = top[1] === lang; continue }
    if (!inside) continue
    // 只认缩进正好两个空格的词条行：块状值（|- 下面的续行）缩进更深，不能被当成词条。
    const hit = /^  ([^:#]+):\s?(.*)$/.exec(raw)
    if (!hit) continue
    const key = hit[1].trim()
    if (key.indexOf('env.diagWriteModel') !== 0) continue
    out[key] = hit[2].trim()
  }
  return out
}

/** 规格里写死的六个中文句子：门禁直接对着规格判，不拿实现里的字回抄一遍。 */
const WRITE_MODEL_COPY: Array<{ key: string, zh: string }> = [
  { key: 'env.diagWriteModel', zh: '写模型' },
  { key: 'env.diagWriteModel.local', zh: '本机所有窗口都能写' },
  { key: 'env.diagWriteModel.network', zh: '这份库在网络盘上，同一时刻只有一个窗口能写' },
  { key: 'env.diagWriteModel.networkFallback', zh: '另一个窗口正在写这份库，本窗口暂时只读' },
  { key: 'env.diagWriteModel.readonly', zh: '这个工作区所在的磁盘不能写' },
  { key: 'env.diagWriteModel.legacy', zh: '还有窗口在用旧版本写这个工作区，请重启所有窗口' },
]

async function run(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1933-'))
  const workspaceDir = path.join(tempRoot, 'workspace')
  mkdirSync(path.join(workspaceDir, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(workspaceDir, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1933\n')

  // ── A 路径判定：UNC / 本地 / 选项覆盖 ───────────────────────────────────────
  {
    check(detectStorageKind('\\\\server\\share\\snap.sqlite') === 'network',
      'A1 \\\\server\\share 形式的 UNC 判成 network')
    check(detectStorageKind('//server/share/snap.sqlite') === 'network',
      'A2 //server/share 形式的 UNC 也判成 network')
    check(detectStorageKind(path.join(tempRoot, 'db', 'local.sqlite'), { platform: 'win32', networkDrivesOf: () => [] }) === 'local',
      'A3 本机盘符路径判成 local（不在网络盘集合里就是本地）')

    const overrideNetPath = path.join(tempRoot, 'db', 'override-network.sqlite')
    const forcedNet = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir, backend: 'github', repoIdentity: REPO.refId,
      dbPath: overrideNetPath, now: () => Date.now(), storageKind: 'network',
    })
    check(forcedNet.mode === 'writable' && forcedNet.storageKind === 'network' && forcedNet.handle.storageKind === 'network',
      'A4 开库选项的 storageKind 覆盖生效：本地路径可以按网络盘单写者打开', { mode: forcedNet.mode, storageKind: forcedNet.storageKind })
    forcedNet.handle.close()

    const overrideLocalPath = path.join(tempRoot, 'db', 'override-local.sqlite')
    const forcedLocal = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir, backend: 'github', repoIdentity: REPO.refId,
      dbPath: overrideLocalPath, now: () => Date.now(), storageKind: 'local',
    })
    check(forcedLocal.mode === 'writable' && forcedLocal.storageKind === 'local',
      'A5 覆盖同样能指定本地盘（两条路都受同一个选项控制）', { mode: forcedLocal.mode, storageKind: forcedLocal.storageKind })
    forcedLocal.handle.close()
  }

  // ── B 网络盘回退：单写者、第二个只读但仍能读、第一个关掉后第三个接手 ──────────
  {
    const netDbPath = path.join(tempRoot, 'db', 'network.sqlite')
    const netOpen = (owner: string) => openWorkspaceSnapshot({
      workspaceRoot: workspaceDir, backend: 'github', repoIdentity: REPO.refId,
      dbPath: netDbPath, leaseOwner: owner, now: () => Date.now(), storageKind: 'network',
    })

    const holder = netOpen('gate-1933-net-holder')
    check(holder.mode === 'writable' && holder.storageKind === 'network',
      'B1 网络盘：第一个句柄拿到写权，storageKind 是 network', { mode: holder.mode, storageKind: holder.storageKind })
    const wrote = writeRow(holder.handle, 'N1', '网络盘上的票')
    check(wrote.committed === true, 'B2 网络盘第一个句柄能写', wrote)
    const held = leaseRowOf(netDbPath)
    check(held.owner === 'gate-1933-net-holder' && typeof held.heartbeat === 'number' && typeof held.expires === 'number',
      'B3 网络盘回退仍在用 lease_owner / 心跳列 / 过期列（本票不删它们）', held)

    const contender = netOpen('gate-1933-net-contender')
    check(contender.mode === 'readonly' && contender.storageKind === 'network'
      && codeOf(contender).indexOf('lease-held-readonly') >= 0,
      'B4 第二个句柄抢不到租约：退回只读并带 lease-held-readonly 诊断',
      { mode: contender.mode, storageKind: contender.storageKind, codes: codeOf(contender) })
    check(titlesIn(contender.handle).join('|') === '网络盘上的票',
      'B5 只读回退不阻塞读：第二个句柄仍能读到第一个写下的票', titlesIn(contender.handle))
    const refused = writeRow(contender.handle, 'N2', '不该写进去的票')
    check(refused.committed === false && refused.reason === 'readonly',
      'B6 只读句柄拒写，理由是 readonly', refused)
    contender.handle.close()

    holder.handle.close()
    const released = leaseRowOf(netDbPath)
    check(released.owner === null, 'B7 第一个句柄关掉后释放租约（写权交接不靠重启）', released)

    const third = netOpen('gate-1933-net-third')
    const handedOver = writeRow(third.handle, 'N3', '接手之后写的票')
    check(third.mode === 'writable' && handedOver.committed === true,
      'B8 第一个关掉之后第三个句柄能接手写', { mode: third.mode, handedOver })
    third.handle.close()
    check(leaseRowOf(netDbPath).owner === null, 'B9 第三个句柄关掉后同样释放租约', leaseRowOf(netDbPath))
  }

  // ── C 本地盘：两个句柄都可写 ───────────────────────────────────────────────
  {
    const localDbPath = path.join(tempRoot, 'db', 'local-two-writers.sqlite')
    const localOpen = (owner: string) => openWorkspaceSnapshot({
      workspaceRoot: workspaceDir, backend: 'github', repoIdentity: REPO.refId,
      dbPath: localDbPath, leaseOwner: owner, now: () => Date.now(), storageKind: 'local',
    })
    const one = localOpen('gate-1933-local-one')
    const two = localOpen('gate-1933-local-two')
    const a = writeRow(one.handle, 'L1', '第一个本地窗口写的票')
    const b = writeRow(two.handle, 'L2', '第二个本地窗口写的票')
    check(one.mode === 'writable' && two.mode === 'writable' && a.committed === true && b.committed === true,
      'C1 本地盘两个句柄都可写，两笔都提交（不是单写者回退）',
      { one: one.mode, two: two.mode, a, b })
    one.handle.close()
    two.handle.close()
  }

  // ── D 设置页诊断：回包与五档文案键 ───────────────────────────────────────────
  {
    // 真库上的占用读数：storageKind / mode 跟着一起回。
    const realStats: any = await readLibraryStorageStats({ workspaceRoot: workspaceDir, backend: 'github', repoIdentity: REPO.refId })
    check(realStats && realStats.storageKind === 'local' && realStats.mode === 'writable' && realStats.legacyWriterBlocked === false,
      'D1 readLibraryStorageStats 回包带 storageKind / mode / legacyWriterBlocked（本机是 local + writable）', realStats)

    const phoneLocal = makePhone({ readLibraryVersion: async () => 7, readLibraryChangeSet: async () => null, readLibraryStorageStats })
    const localReply: any = await phoneLocal.handleSnapshotStoreStats({ cwd: workspaceDir })
    const localKeys = Object.keys(localReply || {}).sort().join(',')
    check(localReply && localReply.storageKind === 'local' && localReply.mode === 'writable' && localReply.legacyWriterBlocked === false,
      'D2 wf.snapshotStoreStats 回包把写模型三格一起交上来（设置页与占用读数同源）', localReply)
    check(localKeys === 'backend,bytes,legacyWriterBlocked,mode,rows,storageKind,version,workspaceKey',
      'D3 回包键集稳定：没有多塞临时字段，也没有漏掉写模型三格', localKeys)

    // 网络回退的假回包：这一步与真库无关，验的是「固定的事实 → 固定的说法」。
    const phoneNet = makePhone({
      readLibraryVersion: async () => 7,
      readLibraryChangeSet: async () => null,
      readLibraryStorageStats: async () => ({ version: 7, bytes: 4096, rows: 3, mode: 'readonly', storageKind: 'network', legacyWriterBlocked: false }),
    })
    const netReply: any = await phoneNet.handleSnapshotStoreStats({ cwd: workspaceDir })
    check(netReply && netReply.storageKind === 'network' && netReply.mode === 'readonly',
      'D4 网络回退的诊断回包如实说 network + readonly', netReply)
    const fallbackReadout = snapshotWriteModelReadoutOf(netReply)
    check(fallbackReadout.ok === true && fallbackReadout.kind === 'network-single-writer-fallback'
      && fallbackReadout.copyKey === 'env.diagWriteModel.networkFallback',
      'D5 网络回退这一档给出稳定的档名与文案键（与「本窗口持写权」分得开）', fallbackReadout)

    // 五档：每一档的档名与文案键都必须稳定（判据本身是 #1932 的，本票只验五档都接得上词条）。
    const localReadout = snapshotWriteModelReadoutOf({ version: 1, bytes: 1, rows: 1, mode: 'writable', storageKind: 'local' })
    check(localReadout.kind === 'local-multi-writer' && localReadout.copyKey === 'env.diagWriteModel.local',
      'D6 本地多写者一档 → env.diagWriteModel.local', localReadout)
    const readonlyReadout = snapshotWriteModelReadoutOf({ version: 1, bytes: 1, rows: 1, mode: 'readonly', storageKind: 'local' })
    check(readonlyReadout.kind === 'readonly-filesystem' && readonlyReadout.copyKey === 'env.diagWriteModel.readonly',
      'D7 文件系统只读一档 → env.diagWriteModel.readonly', readonlyReadout)
    const netWriterReadout = snapshotWriteModelReadoutOf({ version: 1, bytes: 1, rows: 1, mode: 'writable', storageKind: 'network' })
    check(netWriterReadout.kind === 'network-single-writer' && netWriterReadout.copyKey === 'env.diagWriteModel.network',
      'D8 网络单写者本窗口持写权一档 → env.diagWriteModel.network', netWriterReadout)
    const legacyReadout = snapshotWriteModelReadoutOf({ version: 1, bytes: 1, rows: 1, mode: 'writable', storageKind: 'local', legacyWriterBlocked: true })
    check(legacyReadout.kind === 'legacy-writer-blocked' && legacyReadout.copyKey === 'env.diagWriteModel.legacy',
      'D9 旧租约挡住本地写一档 → env.diagWriteModel.legacy', legacyReadout)
    const unknownReadout = snapshotWriteModelReadoutOf({ ok: false, error: '库打不开' })
    check(unknownReadout.ok === false && unknownReadout.kind === 'unknown' && unknownReadout.copyKey === '',
      'D10 读不到时不给编出来的档位（页面画「—」）', unknownReadout)

    // 页面接线：静态断言它确实用了这个纯函数与这几个词条键。
    const checks = srcText('src/client/views/ChecksTab.ts')
    check(checks.indexOf('declare function snapshotWriteModelReadoutOf') >= 0
      && checks.indexOf('snapshotWriteModelReadoutOf(libraryStatsReply)') >= 0,
      'D11 环境检查页声明并在占用读数上调用 snapshotWriteModelReadoutOf')
    check(checks.indexOf("tr('env.diagWriteModel')") >= 0 && checks.indexOf('tr(writeModel.copyKey)') >= 0,
      'D12 能力诊断里画「写模型」一行：标签走词条，句子按档位取键')

    // 词条真源：两门语言各一份，中文句子与规格一致，英文不许原样抄中文。
    const panelCopy = srcText('config/copy/panel.yaml')
    const zh = copySectionOf(panelCopy, 'zh')
    const en = copySectionOf(panelCopy, 'en')
    for (const entry of WRITE_MODEL_COPY) {
      const zhValue = zh[entry.key] || ''
      const enValue = en[entry.key] || ''
      check(zhValue === entry.zh && enValue.length > 0 && enValue !== zhValue && !/[\u4e00-\u9fff]/.test(enValue),
        'D13 词条 ' + entry.key + ' 中英各一份：中文是规格那句、英文真的翻了', { zh: zhValue, en: enValue })
    }
    // 按「行首两个空格 + 键 + 冒号」数，不能按裸子串数：env.diagWriteModel 是另外五个键的前缀。
    const rawCount = (needle: string): number => (panelCopy.match(new RegExp('^  ' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':', 'gm')) || []).length
    check(WRITE_MODEL_COPY.every((entry) => rawCount(entry.key) === 2),
      'D14 六个词条在词表里各出现两次（中英各一次，没有第三份散落拷贝）')
  }

  // ── E 列表：网络回退原因不上列表状态行 ──────────────────────────────────────
  {
    const at = new Date(2026, 10, 6, 9, 0, 0).getTime()
    const held = truthNoticeLines({ snapshot: { generatedMs: at, snapshotDiagnostics: [{ code: 'lease-held-readonly', message: '另一个窗口在写' }] } }, at)
    check(!held.some((line: any) => line.kind === 'snapshot'), 'E1 lease-held-readonly 不产生列表状态行（回退原因只在设置页/日志）', held)
    const lost = truthNoticeLines({ snapshot: { generatedMs: at, snapshotDiagnostics: [{ code: 'lease-lost-readonly', message: '写权丢了' }] } }, at)
    check(!lost.some((line: any) => line.kind === 'snapshot'), 'E2 lease-lost-readonly 同样不产生列表状态行', lost)
    const corrupt = truthNoticeLines({ snapshot: { generatedMs: at, snapshotDiagnostics: [{ code: 'corrupt-rebuilt', message: '本地快照已重建' }] } }, at)
    check(corrupt.some((line: any) => line.key === 'truth.snapshotCorrupt'),
      'E3 正例：损坏重建仍然要说 —— E1/E2 的「不说话」不是整段判据失效', corrupt)
  }

  // ── F 保留项：租约三列与两个时长配置不许删 ─────────────────────────────────
  {
    const schema = srcText('src/workspace-snapshot/persistence/schema.ts')
    check(schema.indexOf('lease_owner') >= 0 && schema.indexOf('lease_heartbeat_ms') >= 0 && schema.indexOf('lease_expires_ms') >= 0,
      'F1 schema 里 lease_owner / lease_heartbeat_ms / lease_expires_ms 三列都还在')
    check(typeof SNAPSHOT_LEASE_HEARTBEAT_MS === 'number' && SNAPSHOT_LEASE_HEARTBEAT_MS > 0
      && typeof SNAPSHOT_LEASE_TTL_MS === 'number' && SNAPSHOT_LEASE_TTL_MS > SNAPSHOT_LEASE_HEARTBEAT_MS,
      'F2 两个租约时长常量都还在，且过期时间大于心跳间隔（网络回退靠它们续约）',
      { heartbeat: SNAPSHOT_LEASE_HEARTBEAT_MS, ttl: SNAPSHOT_LEASE_TTL_MS })
    const ttlYaml = srcText('config/ttl.yaml')
    check(ttlYaml.indexOf('snapshotLeaseTtlMs') >= 0, 'F3 config/ttl.yaml 仍定义 snapshotLeaseTtlMs')
    const intervalsYaml = srcText('config/intervals.yaml')
    check(intervalsYaml.indexOf('snapshotLeaseHeartbeatMs') >= 0, 'F4 config/intervals.yaml 仍定义 snapshotLeaseHeartbeatMs')
  }

  // ── G 文档：回退原因只在设置页/日志，升级要全窗口重启 ───────────────────────
  {
    const readme = srcText('src/workspace-snapshot/README.md')
    const modelSection = (readme.split('## 写模型')[1] || '').split('\n## ')[0]
    check(modelSection.indexOf('设置页') >= 0 && modelSection.indexOf('日志') >= 0 && modelSection.indexOf('列表') >= 0,
      'G1 README 写模型一节写明：回退原因只在设置页与日志，不在列表状态行', modelSection.length)
    check(modelSection.indexOf('重启所有窗口') >= 0,
      'G2 README 写模型一节写明升级要求：还有旧版本窗口在写时要重启所有窗口')
  }

  closeSnapshotLibraries()
  for (let i = 0; i < 3; i += 1) {
    try { rmSync(tempRoot, { recursive: true, force: true }); break } catch (error) {
      if (i === 2) console.log('提示：临时目录没能立刻删掉（Windows 上文件刚关掉时常见）：' + String((error as any) && (error as any).message))
    }
  }
  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 网络盘回退与设置页诊断门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

run().catch((error) => {
  console.log('FAIL 门禁异常退出：' + ((error && error.stack) || error))
  printGateResult(GATE, total, failed + 1)
  process.exitCode = 1
})
