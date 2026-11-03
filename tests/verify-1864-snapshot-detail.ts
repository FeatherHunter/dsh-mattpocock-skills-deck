/**
 * tests/verify-1864-snapshot-detail.ts —— 单票详情与关系从快照库出（#1864）
 *
 * 守什么：详情读结果按组写进本地快照库（正文、标签、父票、阻塞、子票计数、合并信息），
 * 详情读投影再把它们按三态读回来。票面五条验收逐条对应：
 *   A 进入详情只表达这一张票的那几组：别的票的内容与组记录时刻都不动；
 *   B 父子、阻塞、被阻塞三个方向都从同一张边表得出，清掉一条边三个方向一起变；
 *   C「确认没有」（complete 且为空）与「不知道」（没有组记录 / unknown 带原因）分得开，
 *     未知带上次已知时刻；
 *   D 引用骨架（只在边里被提到、自己没被完整取过的票）标得出来，且不出现在完整票的列表里；
 *   E 关库重开后详情、三态与三个方向都还在，不靠进程内状态。
 *
 * 为什么要真库：三态存在 issue_group、正文在独立表、关系在边表，替身盖不住这些跨表行为。
 * 临时目录用 os.tmpdir()，跑完删干净。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1864-snapshot-detail.ts
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
  WorkspaceSnapshotHandle,
} from '../src/workspace-snapshot/contract/types.ts'
import type { IssueDetail, IssueRowValue } from '../src/workspace-snapshot/model/types.ts'

const GATE = 'verify-1864-snapshot-detail'
const CLOCK = 1762310000000
const CLOCK_LATER = CLOCK + 60000
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

function rowValue(key: string, state: string, extra?: Partial<IssueRowValue>): IssueRowValue {
  return Object.assign({ type: 'issue', title: '票 ' + key, state, url: 'https://example.test/' + key, updatedAtMs: CLOCK }, extra || {})
}

function rowGroup(value: IssueRowValue | null): IssueGroupsWrite['row'] {
  return { completeness: 'complete', value, source: 'gate', operation: 'get' }
}

function complete<T>(value: T, operation = 'get'): GroupWrite<T> {
  return { completeness: 'complete', value, source: 'gate', operation }
}

function unknown<T>(reason: string): GroupWrite<T> {
  return { completeness: 'unknown', reason, source: 'gate', operation: 'get' }
}

function write(key: string, groups: IssueGroupsWrite, effortId = ''): IssueWrite {
  return { effortId, key, groups }
}

function detailOf(handle: WorkspaceSnapshotHandle, key: string, effortId = ''): IssueDetail | null {
  return handle.readIssueDetail({ effortId, key }).issue
}

function keysOf(refs: Array<{ key: string }>): string[] {
  return refs.map((ref) => ref.key)
}

function main(): void {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1864-detail-'))
  // 断言中途抛错时也要先把库关掉：Windows 上句柄没关就删目录会报 EPERM，把真正的报错盖住。
  const openedHandles: WorkspaceSnapshotHandle[] = []
  try {
    const dbPath = path.join(tempRoot, 'db', 'snapshot.sqlite')
    mkdirSync(path.dirname(dbPath), { recursive: true })
    let clock = CLOCK
    const opened: OpenWorkspaceSnapshotResult = openWorkspaceSnapshot({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: 'acme/repo-a',
      dbPath,
      now: () => clock,
      leaseOwner: 'gate-1864',
    })
    check(opened.mode === 'writable', 'A0 临时库以可写模式打开', opened.mode)
    const handle = opened.handle
    openedHandles.push(handle)

    // ── 先放两张别的票：后面断言详情写入不碰它们 ─────────────────────────────
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [
        write('90', { row: rowGroup(rowValue('90', 'closed')) }),
        write('100', { row: rowGroup(rowValue('100', 'open', { type: 'map', title: '地图 100' })) }),
      ],
    })
    const before90 = detailOf(handle, '90')
    const before100 = detailOf(handle, '100')

    // ── A. 详情读结果按组写库：正文、标签、父票、阻塞、子票计数、合并信息 ────────
    clock = CLOCK_LATER
    const first = handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [
        write('5', {
          row: rowGroup(rowValue('5', 'open', { title: '子票五' })),
          body: complete('这是正文。'),
          labels: complete([{ name: 'ready-for-agent', color: '00ff00' }]),
          parents: complete(['100']),
          blockedBy: complete(['90']),
          subIssues: complete({ total: 3, completed: 1, percent: 33 }),
          mergeInfo: complete(null),
        }),
      ],
    })
    check(first.committed === true, 'A1 一批详情写入提交成功', first)

    const five = detailOf(handle, '5')
    check(!!five, 'A2 详情读得回来', five)
    check(five?.body === '这是正文。', 'A3 正文按组读回', five?.body)
    check(five?.row.title === '子票五' && five?.row.state === 'open', 'A4 行字段读回', five?.row)
    check(five?.labels.length === 1 && five?.labels[0].name === 'ready-for-agent', 'A5 标签读回', five?.labels)
    check(five?.subIssues?.total === 3 && five?.subIssues?.completed === 1, 'A6 子票计数读回', five?.subIssues)
    check(five?.mergedAtMs === null && five?.groups.mergeInfo?.completeness === 'complete', 'A7 合并信息「确认还没合并」读得回来', five?.groups.mergeInfo)
    check(five?.groups.body?.completeness === 'complete' && five?.groups.body?.operation === 'get', 'A8 正文组盖了完整度与读操作', five?.groups.body)
    check(five?.groups.subIssues?.completeness === 'complete', 'A9 子票计数组盖了完整度', five?.groups.subIssues)

    // A10：别的票一个字节没动（内容、三态时刻、合并版本不因它们改变）
    const after90 = detailOf(handle, '90')
    const after100 = detailOf(handle, '100')
    check(after90?.row.state === before90?.row.state && after90?.row.title === before90?.row.title, 'A10 别的票的内容不变', after90?.row)
    check(after90?.lastKnownAtMs === before90?.lastKnownAtMs, 'A11 别的票的组记录时刻不变', [before90?.lastKnownAtMs, after90?.lastKnownAtMs])
    check(after100?.groups.body === null && after100?.groups.labels === null, 'A12 没表达过的组在别的票上仍是「从没取过」', after100?.groups)
    check(five?.groups.labels !== null && five?.groups.assignees === null, 'A13 只表达的组才盖章，没表达的不盖章', five?.groups)

    // ── B. 父子、阻塞、被阻塞三个方向从同一份数据得出 ───────────────────────────
    check(keysOf(five?.parents || [])[0] === '100', 'B1 子票读回父票', five?.parents)
    check(keysOf(detailOf(handle, '100')?.children || []).indexOf('5') >= 0, 'B2 父票反向读回子票', detailOf(handle, '100')?.children)
    check(keysOf(five?.blockedBy || [])[0] === '90', 'B3 子票读回阻塞者', five?.blockedBy)
    check(keysOf(detailOf(handle, '90')?.blocking || []).indexOf('5') >= 0, 'B4 阻塞者反向读回「我挡住了谁」', detailOf(handle, '90')?.blocking)
    const listFive = handle.readList({ state: 'all' }).issues.filter((item) => item.key === '5')[0]
    check(JSON.stringify(keysOf(listFive?.blockedBy || [])) === JSON.stringify(keysOf(five?.blockedBy || [])), 'B5 列表与详情读到的阻塞边一致（同一份数据）', {
      list: keysOf(listFive?.blockedBy || []),
      detail: keysOf(five?.blockedBy || []),
    })
    check(listFive?.blockedBy?.[0]?.state === 'closed', 'B6 阻塞边的目标状态随边一起读回（状态胶囊以库为准）', listFive?.blockedBy)

    // 清空阻塞边：三个方向一起变，不会留下互相矛盾的读数
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('5', { blockedBy: complete([]) })],
    })
    check((detailOf(handle, '5')?.blockedBy || []).length === 0, 'B7 complete 空数组清空阻塞边', detailOf(handle, '5')?.blockedBy)
    check(keysOf(detailOf(handle, '90')?.blocking || []).indexOf('5') < 0, 'B8 清空后反向的「我挡住了谁」也跟着消失', detailOf(handle, '90')?.blocking)
    check((detailOf(handle, '90')?.blocking || []).length === 0 && detailOf(handle, '90')?.groups.blockedBy === null, 'B9 被阻塞方向只剩同一条边表的读数，没有第二份', detailOf(handle, '90'))

    // ── C.「确认没有」与「不知道」分得开，未知带上次已知时刻 ──────────────────────
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [
        write('6', { row: rowGroup(rowValue('6', 'open')) }),
        write('7', { row: rowGroup(rowValue('7', 'open')), body: complete(''), labels: complete([]) }),
        write('10', { row: rowGroup(rowValue('10', 'open')), body: complete('旧正文') }),
      ],
    })
    const six = detailOf(handle, '6')
    const seven = detailOf(handle, '7')
    check(six?.body === null && six?.groups.body === null, 'C1 从没取过正文 = 不知道（body 为 null、没有组记录）', six?.groups.body)
    check(seven?.body === '' && seven?.groups.body?.completeness === 'complete', 'C2 完整取过且为空 = 确认没有正文', seven?.body)
    check(seven?.labels.length === 0 && seven?.groups.labels?.completeness === 'complete', 'C3 完整取过且没有标签 = 确认没有', seven?.groups.labels)

    clock = CLOCK_LATER + 60000
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('7', { labels: unknown<never[]>('not-applicable') }), write('10', { body: unknown<string>('not-expressed') })],
    })
    const sevenAfter = detailOf(handle, '7')
    const tenAfter = detailOf(handle, '10')
    check(tenAfter?.body === '旧正文', 'C4 unknown 不删上次已知的正文', tenAfter?.body)
    check(tenAfter?.groups.body?.completeness === 'unknown' && tenAfter?.groups.body?.reason === 'not-expressed', 'C5 unknown 盖住完整度与原因', tenAfter?.groups.body)
    check(sevenAfter?.labels.length === 0 && sevenAfter?.groups.labels?.completeness === 'unknown', 'C6 unknown 不删「确认没有」的旧值，只改完整度', sevenAfter?.groups.labels)
    check(sevenAfter?.lastKnownAtMs === CLOCK_LATER + 60000, 'C7 未知带上次已知时刻（各组最近一次被查询的时刻）', sevenAfter?.lastKnownAtMs)
    check(seven?.lastKnownAtMs === CLOCK_LATER, 'C8 上一次已知时刻停在上一轮', seven?.lastKnownAtMs)

    // 父票：complete 空 = 确认没有父票；没有组记录 = 不知道
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('8', { row: rowGroup(rowValue('8', 'open')), parents: complete([]) })],
    })
    const eight = detailOf(handle, '8')
    check(eight?.parents.length === 0 && eight?.groups.parents?.completeness === 'complete', 'C9 完整取过且没有父票 = 确认没有', eight?.groups.parents)
    check((detailOf(handle, '6')?.groups.parents ?? null) === null, 'C10 从没取过父票 = 不知道（没有组记录）', detailOf(handle, '6')?.groups.parents)

    // ── D. 引用骨架：只在边里被提到、自己没被完整取过的票 ────────────────────────
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('9', { row: rowGroup(rowValue('9', 'open')), parents: complete(['777']) })],
    })
    const skeleton = detailOf(handle, '777')
    check(!!skeleton && skeleton.referenceSkeleton === true, 'D1 只有身份的票被标成引用骨架', skeleton)
    check(!!skeleton && skeleton.groups.row === null, 'D2 引用骨架没有行组记录', skeleton?.groups)
    check(keysOf(detailOf(handle, '9')?.parents || [])[0] === '777', 'D3 引用骨架上的边仍然读得出来', detailOf(handle, '9')?.parents)
    check(handle.readList({ state: 'all' }).issues.filter((item) => item.key === '777').length === 0, 'D4 引用骨架不出现在完整票的列表里')
    handle.ingest({
      startMergeVersion: handle.getMergeVersion(),
      writes: [write('777', { row: rowGroup(rowValue('777', 'open', { title: '后来取到的票' })) })],
    })
    const filled = detailOf(handle, '777')
    check(filled?.referenceSkeleton === false && filled?.row.title === '后来取到的票', 'D5 真正取过之后不再是骨架', filled)
    check(handle.readList({ state: 'all' }).issues.filter((item) => item.key === '777').length === 1, 'D6 取过之后出现在列表里')

    // ── E. 关库重开：详情、三态与三个方向都还在 ────────────────────────────────
    const beforeClose = detailOf(handle, '5')
    handle.close()
    const reopened = openWorkspaceSnapshot({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: 'acme/repo-a',
      dbPath,
      now: () => clock,
      leaseOwner: 'gate-1864-reopen',
    })
    check(reopened.mode === 'writable', 'E0 重开仍是可写模式', reopened.mode)
    openedHandles.push(reopened.handle)
    const afterReopen = detailOf(reopened.handle, '5')
    check(afterReopen?.body === beforeClose?.body && afterReopen?.row.title === beforeClose?.row.title, 'E1 重开后正文与行字段一致', afterReopen?.body)
    check(afterReopen?.groups.body?.completeness === 'complete', 'E2 重开后组的三态还在', afterReopen?.groups.body)
    check(keysOf(afterReopen?.parents || [])[0] === '100', 'E3 重开后父子方向还在', afterReopen?.parents)
    check(keysOf(detailOf(reopened.handle, '100')?.children || []).indexOf('5') >= 0, 'E4 重开后反向的子票方向还在', detailOf(reopened.handle, '100')?.children)
    check(afterReopen?.subIssues?.total === 3, 'E5 重开后子票计数还在', afterReopen?.subIssues)
    check(detailOf(reopened.handle, '777')?.referenceSkeleton === false, 'E6 重开后骨架状态也一致')
    check(detailOf(reopened.handle, '404') === null, 'E7 库里根本没有的票读回 null（不是空壳）', detailOf(reopened.handle, '404'))
    reopened.handle.close()
  } finally {
    for (const opened of openedHandles) {
      try { opened.close() } catch { /* 已经关过或已关库 */ }
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }
  printGateResult(GATE, total, failed)
}

main()
