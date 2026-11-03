/**
 * tests/verify-1862-snapshot-database.ts —— 工作区快照库的真文件门禁（#1862）
 *
 * 守什么：这一票不接受数据库替身，所有断言都在临时目录里的真 SQLite 文件上跑，走的是
 * 「开库 → 写一批 → 关库 → 重开 → 读回」这条真实路径。逐条对应票 #1862 的验收：
 *   A 真库写入后关闭重开，数据一致（包括版本、标签、指派人、三态）；
 *   B 一轮写入失败时整批不生效，库停在上一轮（用真约束错误触发，不 mock 事务）；
 *   C 第二个写者抢不到租约退回只读，上层从 mode / diagnostics / ingest 三处都能感知；
 *   D 过期批次被版本门整批丢弃，库里字节不变；
 *   E 损坏库被识别、备份三件套、整库重建并留下诊断与日志；
 *   F 完整来源可覆盖与清空，截断只补空缺，未知不删旧值；
 *   G 列表投影只返回有 row 组的票，按状态与更新时间排序，引用骨架不出现；
 *   H 身份不符与「目标文件不是本工具的库」两种情况下整库重建，不静默串数据；
 *   I 默认库路径按 workspace.yaml 找到的工作区根落地，而不是调用方传进来的子目录。
 *
 * 为什么用真库：租约、WAL、回滚、损坏检测这些行为只有真 SQLite 才有；换成替身等于
 * 把要证的结论假设进替身里。临时目录用 os.tmpdir()，每趟结束删干净。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1862-snapshot-database.ts
 */
// 门禁归属: src/workspace-snapshot

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import type {
  IssueGroupsWrite,
  IssueWrite,
  OpenWorkspaceSnapshotResult,
  SnapshotLogEvent,
  WriteBatch,
} from '../src/workspace-snapshot/contract/types.ts'
import type {
  GroupCompleteness,
  IssueRowValue,
  SnapshotLabel,
} from '../src/workspace-snapshot/model/types.ts'

const GATE = 'verify-1862-snapshot-database'
const CLOCK = 1762300000000
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

function now(): number {
  return CLOCK
}

function rowGroup(
  value: IssueRowValue | null,
  completeness: GroupCompleteness = 'complete',
): IssueGroupsWrite['row'] {
  return { completeness, value, source: 'gate', operation: 'get' }
}

function write(effortId: string, key: string, groups: IssueGroupsWrite): IssueWrite {
  return { effortId, key, groups }
}

function batch(startMergeVersion: number, writes: IssueWrite[]): WriteBatch {
  return { startMergeVersion, writes }
}

function byKey(result: { issues: Array<{ key: string }> }, key: string): any {
  return result.issues.filter((item) => item.key === key)[0]
}

function main(): void {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1862-'))
  try {
    const workspaceDir = path.join(tempRoot, 'workspace')
    mkdirSync(workspaceDir, { recursive: true })
    const dbPath = path.join(tempRoot, 'db', 'snapshot.sqlite')

    const opened = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir,
      backend: 'markdown',
      repoIdentity: 'repo-a',
      dbPath,
      now,
    })
    let handle = opened.handle
    check(
      opened.mode === 'writable' && handle.mode === 'writable' && handle.getMergeVersion() === 0,
      'A1 首次开库是可写模式、合并版本 0',
      { mode: opened.mode, version: handle.getMergeVersion() },
    )

    const seed = handle.ingest(batch(0, [
      write('effort-1', 'A', {
        row: rowGroup({ type: 'issue', title: 'A 票', state: 'open', updatedAtMs: 3000, url: 'https://example.test/a' }),
        labels: { completeness: 'complete', value: [{ name: 'bug', color: '#d73a4a' }, { name: 'docs', color: null }], source: 'gate' },
        assignees: { completeness: 'complete', value: [{ login: 'alice' }, { login: 'bob' }], source: 'gate' },
      }),
      write('effort-1', 'B', {
        row: rowGroup({ type: 'issue', title: 'B 票', state: 'closed', updatedAtMs: 1000 }),
      }),
      write('effort-1', 'C', {
        row: rowGroup({ type: 'issue', title: 'C 票', state: 'open', updatedAtMs: 4000, commentCount: 7 }, 'truncated'),
      }),
      write('effort-1', 'SKELETON', {
        labels: { completeness: 'complete', value: [{ name: 'docs' }] },
      }),
    ]))
    check(
      seed.committed === true && seed.mergeVersion === 1,
      'A2 一批读结果提交后合并版本加一',
      seed,
    )

    let page = handle.readList()
    check(
      page.issues.length === 2 && page.issues[0].key === 'C' && page.issues[1].key === 'A',
      'G1 列表默认只出 open、按更新时间倒序（C 4000 > A 3000），引用骨架 SKELETON 不出现',
      page.issues.map((item) => item.key),
    )
    const a = byKey(page, 'A')
    check(
      a.labels.length === 2 && a.labels[0].name === 'bug' && a.labels[0].color === '#d73a4a'
        && a.assignees.length === 2 && a.assignees[0].login === 'alice',
      'A4 标签定义（名字与颜色）与指派人按写入顺序读回',
      { labels: a.labels, assignees: a.assignees },
    )
    const c = byKey(page, 'C')
    check(
      c.groups.row.completeness === 'truncated' && c.row.commentCount === 7 && c.row.title === 'C 票',
      'A5 truncated 的 row 也出现在列表里，并如实带三态与已填字段',
      c,
    )
    const all = handle.readList({ state: 'all' })
    const limited = handle.readList({ limit: 1 })
    check(
      all.issues.length === 3 && all.issues.filter((item: any) => item.key === 'B')[0].row.state === 'closed'
        && limited.issues.length === 1,
      'G2 state=all 能看到 closed；limit 生效', { all: all.issues.length, limited: limited.issues.length },
    )
    check(
      page.mergeVersion === 1 && page.generatedAtMs === CLOCK
        && a.groups.labels?.source === 'gate' && a.groups.labels?.lastQueriedMs === CLOCK,
      'A6 读投影带出库版本、生成时刻与每组来源/上次查询时间',
      { version: page.mergeVersion, groups: a.groups },
    )

    // ---- 关库再重开：数据必须来自真实文件，而不是进程内缓存 ----
    handle.close()
    const reopened = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir,
      backend: 'markdown',
      repoIdentity: 'repo-a',
      dbPath,
      now,
    })
    handle = reopened.handle
    page = handle.readList()
    const reopenedA = byKey(page, 'A')
    check(
      reopened.mode === 'writable' && reopened.handle.getMergeVersion() === 1
        && page.issues.length === 2 && reopenedA.labels.length === 2 && reopenedA.assignees.length === 2,
      'A7 关闭后重开同一文件：版本、行、标签、指派人都一致',
      { mode: reopened.mode, version: handle.getMergeVersion(), keys: page.issues.map((item) => item.key) },
    )

    // ---- 第二个写者：抢不到租约，退回只读，但读得到 ----
    const second = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir,
      backend: 'markdown',
      repoIdentity: 'repo-a',
      dbPath,
      now,
      leaseOwner: 'gate-second-writer',
    })
    const secondIngest = second.handle.ingest(batch(1, [
      write('effort-1', 'SECOND', { row: rowGroup({ title: '不该写进去', state: 'open', updatedAtMs: 9999 }) }),
    ]))
    const secondPage = second.handle.readList()
    second.handle.close()
    check(
      second.mode === 'readonly' && second.handle.mode === 'readonly'
        && second.diagnostics.some((item) => item.code === 'lease-held-readonly'),
      'C1 第二个写者抢不到租约：mode 是 readonly，诊断里有 lease-held-readonly',
      { mode: second.mode, diagnostics: second.diagnostics },
    )
    check(
      secondIngest.committed === false && secondIngest.reason === 'readonly'
        && secondPage.issues.length === 2,
      'C2 只读句柄拒写、仍可读，上层能明确知道原因',
      secondIngest,
    )

    // ---- 一轮写入失败：整批回滚，库停在上一轮 ----
    const failedBatch = handle.ingest(batch(1, [
      write('effort-1', 'E', { row: rowGroup({ title: 'E 票', state: 'open', updatedAtMs: 5000 }) }),
      write('effort-1', 'E', {
        // 故意给一个没有名字的标签：真 STRICT 表会拒，事务必须整批回滚。
        labels: { completeness: 'complete', value: [{ name: null } as unknown as SnapshotLabel] },
      }),
    ]))
    const afterFailure = handle.readList({ state: 'all' })
    check(
      failedBatch.committed === false && failedBatch.reason === 'write-failed',
      'B1 约束错误让整批写入失败并报 write-failed',
      failedBatch,
    )
    check(
      handle.getMergeVersion() === 1
        && afterFailure.issues.filter((item) => item.key === 'E').length === 0,
      'B2 失败批次连自己已经写好的行也不留下，版本停在上一轮',
      { version: handle.getMergeVersion(), keys: afterFailure.issues.map((item) => item.key) },
    )

    // ---- 版本门：过期批次整批丢弃 ----
    const stale = handle.ingest(batch(0, [
      write('effort-1', 'A', { labels: { completeness: 'complete', value: [] } }),
    ]))
    const afterStale = byKey(handle.readList(), 'A')
    check(
      stale.committed === false && stale.reason === 'stale'
        && handle.getMergeVersion() === 1 && afterStale.labels.length === 2,
      'D1 startMergeVersion 小于表达组上次写入版本时整批丢弃，库里一个字节不改',
      { stale, version: handle.getMergeVersion(), labels: afterStale.labels },
    )

    // ---- 完整来源：覆盖与清空 ----
    const cleared = handle.ingest(batch(1, [
      write('effort-1', 'A', { labels: { completeness: 'complete', value: [] } }),
    ]))
    const afterClear = byKey(handle.readList(), 'A')
    check(
      cleared.committed === true && cleared.mergeVersion === 2
        && afterClear.labels.length === 0 && afterClear.groups.labels?.completeness === 'complete',
      'F1 complete + 空数组清空整组，并盖 complete 章',
      { cleared, labels: afterClear.labels, groups: afterClear.groups },
    )

    // ---- truncate 只补空缺 ----
    const filled = handle.ingest(batch(2, [
      write('effort-1', 'A', {
        row: { completeness: 'truncated', value: { title: '不该覆盖', stateReason: 'completed', commentCount: 9 }, source: 'gate' },
      }),
    ]))
    const afterFill = byKey(handle.readList(), 'A')
    check(
      filled.committed === true && filled.mergeVersion === 3
        && afterFill.row.title === 'A 票' && afterFill.row.url === 'https://example.test/a'
        && afterFill.row.stateReason === 'completed' && afterFill.row.commentCount === 9,
      'F2 truncated 只补原来为 NULL 的列（关闭原因、评论数），已有标题与链接不动',
      afterFill.row,
    )

    // ---- unknown 只盖章 ----
    const unknownRow = handle.ingest(batch(3, [
      write('effort-1', 'A', {
        row: { completeness: 'unknown', reason: 'not-expressed', value: { title: '不该看' } },
      }),
    ]))
    const afterUnknown = byKey(handle.readList(), 'A')
    check(
      unknownRow.committed === true && afterUnknown.row.title === 'A 票'
        && afterUnknown.groups.row?.completeness === 'unknown'
        && afterUnknown.groups.row?.reason === 'not-expressed',
      'F3 unknown 带上原因只盖章，旧值一个都不删',
      afterUnknown.groups.row,
    )

    const appendLabels = handle.ingest(batch(4, [
      write('effort-1', 'A', { labels: { completeness: 'truncated', value: [{ name: 'docs' }] } }),
    ]))
    const keptLabels = handle.ingest(batch(5, [
      write('effort-1', 'A', { labels: { completeness: 'unknown', value: [{ name: 'zzz' }] } }),
    ]))
    const afterLabels = byKey(handle.readList(), 'A')
    check(
      appendLabels.committed === true && keptLabels.committed === true
        && afterLabels.labels.length === 1 && afterLabels.labels[0].name === 'docs',
      'F4 truncated 只补旧组没有的标签；unknown 不删也不补',
      afterLabels.labels,
    )

    const emptyBatch = handle.ingest(batch(handle.getMergeVersion(), []))
    check(
      emptyBatch.committed === true && emptyBatch.mergeVersion === handle.getMergeVersion(),
      'D2 空批不开事务、不抬版本（否则会让别人的起点提前过期）',
      emptyBatch,
    )

    // ---- complete + null 确认不存在：删行并级联清子表 ----
    const removed = handle.ingest(batch(6, [
      write('effort-1', 'A', { row: { completeness: 'complete', value: null } }),
    ]))
    const afterRemove = handle.readList({ state: 'all' })
    check(
      removed.committed === true && removed.mergeVersion === 7
        && afterRemove.issues.filter((item) => item.key === 'A').length === 0
        && afterRemove.issues.filter((item) => item.key === 'SKELETON').length === 0,
      'F5 complete + null 确认票不存在：行从列表消失，引用骨架仍然不出现',
      afterRemove.issues.map((item) => item.key),
    )
    handle.ingest(batch(7, [
      write('effort-1', 'A', { row: rowGroup({ title: 'A 回来', state: 'open', updatedAtMs: 5000 }) }),
    ]))
    const readded = byKey(handle.readList(), 'A')
    check(
      readded.row.title === 'A 回来' && readded.labels.length === 0,
      'F6 删行时级联清掉标签，重新建行后标签为空（不会捡到旧成员关系）',
      { row: readded.row, labels: readded.labels },
    )
    const finalPage = handle.readList()
    check(
      finalPage.issues[0].key === 'A' && finalPage.issues[1].key === 'C',
      'G3 列表顺序按 updated_at_ms 倒序：A 5000 在 C 4000 前',
      finalPage.issues.map((item: any) => item.key),
    )

    handle.close()

    // ---- 损坏：识别、备份、重建、诊断与日志 ----
    const snapshotDir = path.dirname(dbPath)
    rmSync(dbPath + '-wal', { force: true })
    rmSync(dbPath + '-shm', { force: true })
    writeFileSync(dbPath, '这不是一个 SQLite 文件')
    const events: Array<{ level: string, event: string, fields: Record<string, unknown> }> = []
    const logEvent: SnapshotLogEvent = (level, event, fields) => { events.push({ level, event, fields }) }
    const corrupted = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir,
      backend: 'markdown',
      repoIdentity: 'repo-a',
      dbPath,
      now,
      logEvent,
    })
    const backups = readdirSync(snapshotDir).filter((name) => name.indexOf('.corrupt-') >= 0)
    check(
      corrupted.mode === 'writable'
        && corrupted.diagnostics.some((item) => item.code === 'corrupt-rebuilt')
        && corrupted.handle.getMergeVersion() === 0
        && corrupted.handle.readList({ state: 'all' }).issues.length === 0,
      'E1 损坏库被识别并整库重建：回到空库、版本 0，诊断里留 corrupt-rebuilt',
      { diagnostics: corrupted.diagnostics, version: corrupted.handle.getMergeVersion() },
    )
    check(
      backups.length === 1,
      'E2 重建前把坏库改成 .corrupt-<时间戳> 备份，不静默删除证据',
      backups,
    )
    check(
      events.some((item) => item.event === 'workspaceSnapshot.corrupt' && item.fields.action === 'rebuilt'),
      'E3 损坏重建在日志里留整趟轨迹（事件名与 action 稳定）',
      events.map((item) => item.event),
    )
    corrupted.handle.close()

    // ---- 身份不符：整库重建，不串数据 ----
    const identityPath = path.join(tempRoot, 'db', 'identity.sqlite')
    const ownerA = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir,
      backend: 'markdown',
      repoIdentity: 'repo-a',
      dbPath: identityPath,
      now,
    })
    ownerA.handle.ingest(batch(0, [
      write('effort-1', 'X', { row: rowGroup({ title: '属于 repo-a', state: 'open', updatedAtMs: 1 }) }),
    ]))
    ownerA.handle.close()
    const ownerB = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir,
      backend: 'markdown',
      repoIdentity: 'repo-b',
      dbPath: identityPath,
      now,
    })
    check(
      ownerB.diagnostics.some((item) => item.code === 'identity-mismatch-rebuilt')
        && ownerB.handle.getMergeVersion() === 0
        && ownerB.handle.readList({ state: 'all' }).issues.length === 0,
      'H1 meta 里的仓库身份与本次不符：整库重建并留诊断，不把 A 仓的数据当 B 仓的',
      { diagnostics: ownerB.diagnostics, version: ownerB.handle.getMergeVersion() },
    )
    ownerB.handle.close()

    // ---- 目标文件不是本工具的库：结构不符也要重建 ----
    const foreignPath = path.join(tempRoot, 'db', 'foreign.sqlite')
    const foreign = new DatabaseSync(foreignPath)
    foreign.exec('CREATE TABLE meta (id INTEGER PRIMARY KEY)')
    foreign.close()
    const reset = openWorkspaceSnapshot({
      workspaceRoot: workspaceDir,
      backend: 'markdown',
      repoIdentity: 'repo-a',
      dbPath: foreignPath,
      now,
    })
    check(
      reset.diagnostics.some((item) => item.code === 'schema-reset')
        && reset.mode === 'writable'
        && reset.handle.getMergeVersion() === 0,
      'H2 user_version=0 且已有同名表的文件：识别为结构不符并重建，诊断里留 schema-reset',
      reset.diagnostics,
    )
    reset.handle.close()

    // ---- 默认路径：按 workspace.yaml 找到工作区根，不落在调用方传的子目录 ----
    const rootDir = path.join(tempRoot, 'real-root')
    const nestedDir = path.join(rootDir, 'packages', 'app')
    mkdirSync(path.join(rootDir, 'docs', 'agents'), { recursive: true })
    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(path.join(rootDir, 'docs', 'agents', 'workspace.yaml'), 'name: gate\n')
    const defaulted = openWorkspaceSnapshot({
      workspaceRoot: nestedDir,
      backend: 'markdown',
      repoIdentity: 'repo-default',
      now,
    })
    const expectedPath = path.join(rootDir, '.dsh-mattskillsdeck-cache', 'snapshot', 'markdown.sqlite')
    check(
      defaulted.mode === 'writable' && existsSync(expectedPath),
      'I1 默认库路径落在 workspace.yaml 所在的工作区根下，而不是 nested 子目录',
      { expectedPath, exists: existsSync(expectedPath) },
    )
    defaulted.handle.close()

    const reopenedDefault = openWorkspaceSnapshot({
      workspaceRoot: nestedDir,
      backend: 'markdown',
      repoIdentity: 'repo-default',
      now,
    })
    check(
      reopenedDefault.mode === 'writable'
        && reopenedDefault.diagnostics.length === 0
        && reopenedDefault.handle.getMergeVersion() === 0,
      'I2 默认路径写出来的文件能按同一身份再次打开，且没有触发任何重建诊断',
      { mode: reopenedDefault.mode, diagnostics: reopenedDefault.diagnostics },
    )
    reopenedDefault.handle.close()
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }

  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 快照库真文件门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main()
