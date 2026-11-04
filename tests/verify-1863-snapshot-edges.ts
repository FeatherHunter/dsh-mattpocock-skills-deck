/**
 * tests/verify-1863-snapshot-edges.ts —— 快照库的关系边门禁（#1863）
 *
 * 守什么：首屏的容器树（父子关系）与票状态胶囊（阻塞关系）要从库里的边读出来，而不是从
 * 在线列表现算。这一票给写入面加了 parents / blockedBy 两组，语义与标签、指派同一套三态：
 *   A complete 整组替换（空数组 = 确认没有），truncated 只补旧组没有的，unknown 一个都不动；
 *   B 边上的目标票可以只有身份（引用骨架），这种行不出现在列表里，但边必须留得住；
 *   C 删掉一张票时它的出边跟着级联消失，不会留下指向别人的孤儿边；
 *   D 一轮「整池重建」只表达开放票时，之前写进来的已关闭票仍然留在库里（本票验收第三条）。
 *
 * 为什么要真库：边表有外键与级联，三态又跨 issue_group 与 issue_edge 两张表，替身盖不住。
 * 临时目录用 os.tmpdir()，跑完删干净。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1863-snapshot-edges.ts
 */
// 门禁归属: src/workspace-snapshot

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import type {
  GroupWrite,
  IssueGroupsWrite,
  IssueWrite,
  OpenWorkspaceSnapshotResult,
  WriteBatch,
} from '../src/workspace-snapshot/contract/types.ts'
import type { GroupCompleteness, IssueRowValue } from '../src/workspace-snapshot/model/types.ts'

const GATE = 'verify-1863-snapshot-edges'
const CLOCK = 1762310000000
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

function rowValue(key: string, state: string): IssueRowValue {
  return { type: 'issue', title: '票 ' + key, state, url: 'https://example.test/' + key, updatedAtMs: CLOCK }
}

function rowGroup(value: IssueRowValue | null, completeness: GroupCompleteness = 'complete'): IssueGroupsWrite['row'] {
  return { completeness, value, source: 'gate', operation: 'list' }
}

function edgeGroup(
  value: string[] | null,
  completeness: GroupCompleteness = 'complete',
  reason?: string,
): GroupWrite<string[] | null> {
  return { completeness, value, reason: reason ?? null, source: 'gate', operation: 'list' }
}

function write(effortId: string, key: string, groups: IssueGroupsWrite): IssueWrite {
  return { effortId, key, groups }
}

function batch(startMergeVersion: number, writes: IssueWrite[]): WriteBatch {
  return { startMergeVersion, writes }
}

function readAll(handle: OpenWorkspaceSnapshotResult['handle']): any {
  return handle.readList({ state: 'all' })
}

function byKey(result: { issues: Array<{ key: string }> }, key: string): any {
  return result.issues.filter((item) => item.key === key)[0]
}

function main(): void {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1863-edges-'))
  try {
    const dbPath = path.join(tempRoot, 'db', 'snapshot.sqlite')
    mkdirSync(path.dirname(dbPath), { recursive: true })
    const opened = openWorkspaceSnapshot({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: 'acme/repo-a',
      dbPath,
      now: () => CLOCK,
      leaseOwner: 'gate-1863',
    })
    check(opened.mode === 'writable', 'A0 临时库以可写模式打开', opened.mode)
    const { handle } = opened

    // A. complete：父子关系与阻塞关系一次写清，读回来带标题与状态
    const v0 = handle.getMergeVersion()
    const first = handle.ingest(batch(v0, [
      write('', '90', { row: rowGroup(rowValue('90', 'open')) }),
      write('', '91', { row: rowGroup(rowValue('91', 'closed')) }),
      write('', '100', { row: rowGroup(rowValue('100', 'open')) }),
      write('', '5', {
        row: rowGroup(rowValue('5', 'open')),
        parents: edgeGroup(['100']),
        blockedBy: edgeGroup(['91', '90']),
      }),
    ]))
    check(first.committed === true, 'A1 第一批写入提交成功', first)

    const list1 = readAll(handle)
    const issue5 = byKey(list1, '5')
    check(JSON.stringify(issue5?.parents) === JSON.stringify(['100']), 'A2 子票读回父票据 key', issue5?.parents)
    check(issue5?.blockedBy?.length === 2, 'A3 阻塞引用读回两条', issue5?.blockedBy)
    check(issue5?.blockedBy?.[0]?.key === '90' && issue5?.blockedBy?.[1]?.key === '91', 'A4 阻塞引用按边界定序（键升序）', issue5?.blockedBy)
    check(issue5?.blockedBy?.[0]?.title === '票 90' && issue5?.blockedBy?.[1]?.state === 'closed', 'A5 阻塞引用带目标票标题与状态', issue5?.blockedBy)
    check(issue5?.groups?.parents?.completeness === 'complete', 'A6 parents 组记录完整度', issue5?.groups?.parents)
    check(issue5?.groups?.blockedBy?.completeness === 'complete', 'A7 blockedBy 组记录完整度', issue5?.groups?.blockedBy)

    // B. 引用骨架：只在边上被提到的票不出现在列表里
    check(byKey(list1, '90') !== undefined && byKey(list1, '100') !== undefined, 'B0 有行记录的父票/阻塞票出现在列表里')
    const v1 = handle.getMergeVersion()
    handle.ingest(batch(v1, [write('', '6', { row: rowGroup(rowValue('6', 'open')), parents: edgeGroup(['777']) })]))
    const list2 = readAll(handle)
    check(byKey(list2, '777') === undefined, 'B1 只有身份、没有行记录的父票不出现在列表里', byKey(list2, '777'))
    check(JSON.stringify(byKey(list2, '6')?.parents) === JSON.stringify(['777']), 'B2 引用骨架上的边仍然读得出来', byKey(list2, '6')?.parents)

    // C. 三态：truncated 只补缺、complete 空数组清空、unknown 不动
    const v2 = handle.getMergeVersion()
    handle.ingest(batch(v2, [write('', '5', { parents: edgeGroup(['100', '101'], 'truncated'), blockedBy: edgeGroup(['91'], 'truncated') })]))
    const list3 = byKey(readAll(handle), '5')
    check(JSON.stringify(list3?.parents) === JSON.stringify(['100', '101']), 'C1 truncated 把新父票补进来', list3?.parents)
    check(list3?.blockedBy?.length === 2, 'C2 truncated 不删旧阻塞边', list3?.blockedBy)

    const v3 = handle.getMergeVersion()
    handle.ingest(batch(v3, [write('', '5', { parents: edgeGroup([], 'complete'), assignees: { completeness: 'complete', value: [] } })]))
    const list4 = byKey(readAll(handle), '5')
    check(JSON.stringify(list4?.parents) === JSON.stringify([]), 'C3 complete 空数组清空父边', list4?.parents)
    check(list4?.blockedBy?.length === 2, 'C4 只表达 parents 时不动 blockedBy', list4?.blockedBy)

    const v4 = handle.getMergeVersion()
    handle.ingest(batch(v4, [write('', '5', { parents: edgeGroup(['999'], 'unknown', 'not-expressed') })]))
    const list5 = byKey(readAll(handle), '5')
    check(JSON.stringify(list5?.parents) === JSON.stringify([]), 'C5 unknown 不写值也不删旧值', list5?.parents)
    check(list5?.groups?.parents?.completeness === 'unknown' && list5?.groups?.parents?.reason === 'not-expressed', 'C6 unknown 盖住完整度与原因', list5?.groups?.parents)
    check(byKey(readAll(handle), '999') === undefined, 'C7 unknown 的引用目标不会被建成骨架行')

    // D. 删除票时出边级联消失
    const v5 = handle.getMergeVersion()
    handle.ingest(batch(v5, [write('', '5', { row: rowGroup(null, 'complete') })]))
    check(byKey(readAll(handle), '5') === undefined, 'D1 row 组 complete + null 删掉这张票')
    const v6 = handle.getMergeVersion()
    handle.ingest(batch(v6, [write('', '5', { row: rowGroup(rowValue('5', 'open')) })]))
    const list6 = byKey(readAll(handle), '5')
    check(JSON.stringify(list6?.parents) === JSON.stringify([]), 'D2 重新建票时看不到上一辈子的父边（级联已清）', list6?.parents)

    // E. 整池重建只表达开放票时，已关闭票留在库里
    const v7 = handle.getMergeVersion()
    handle.ingest(batch(v7, [write('', '50', { row: rowGroup(rowValue('50', 'closed')), blockedBy: edgeGroup(['90']) })]))
    const v8 = handle.getMergeVersion()
    const rebuild = handle.ingest(batch(v8, [
      write('', '90', { row: rowGroup(rowValue('90', 'open')) }),
      write('', '100', { row: rowGroup(rowValue('100', 'open')) }),
      write('', '101', { row: rowGroup(rowValue('101', 'open')) }),
    ]))
    check(rebuild.committed === true, 'E1 整池重建批次提交成功', rebuild)
    const list7 = readAll(handle)
    const closed = byKey(list7, '50')
    check(closed !== undefined && closed.row.state === 'closed', 'E2 重建后已关闭票仍在库里', closed?.row?.state)
    check(JSON.stringify(closed?.blockedBy?.map((r: any) => r.key)) === JSON.stringify(['90']), 'E3 已关闭票的阻塞边也还在', closed?.blockedBy)

    // F. 关库重开后边与三态都还在（真文件，不是内存状态）
    handle.close()
    const reopened = openWorkspaceSnapshot({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: 'acme/repo-a',
      dbPath,
      now: () => CLOCK,
      leaseOwner: 'gate-1863-reopen',
    })
    const list8 = byKey(readAll(reopened.handle), '5')
    const issue6After = byKey(readAll(reopened.handle), '6')
    check(reopened.mode === 'writable', 'F0 重开仍是可写模式', reopened.mode)
    check(list8 !== undefined && JSON.stringify(list8.parents) === JSON.stringify([]), 'F1 重开后父边与关闭前一致', list8?.parents)
    check(issue6After?.groups?.parents?.completeness === 'complete', 'F2 重开后 groups 三态仍在', issue6After?.groups?.parents)
    check(list8?.groups?.parents === null, 'F3 重建过的票没有 parents 组记录（从没取过 = null，不是 unknown）', list8?.groups?.parents)
    reopened.handle.close()
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
  printGateResult(GATE, total, failed)
}

main()
