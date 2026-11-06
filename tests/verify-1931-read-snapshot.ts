/**
 * tests/verify-1931-read-snapshot.ts —— 读快照一致与冲突规则（#1931，规格 #1930）
 *
 * 守什么（票面五条验收逐条落在这里）：
 *   A 读事务一致：一次投影读到的版本与它读到的每一行来自同一个库快照。做法是给开库入口传一个
 *     只在门禁里用的步骤钩子（onReadStep）：钩子在投影的事务中间被调用，用第二个连接提交一笔真写。
 *     同一次投影仍旧只看见写之前的版本与写之前的值；下一次投影才看见新版本与新值。
 *     五条投影（列表、详情、容器、变化集、计数）各来一遍 —— 版本与数据分了家，就是「同一屏上
 *     一半旧一半新」那个故障。
 *   B 读结果的行组严格时间：来者的 updatedAt 严格新于库里已存才覆盖；持平不覆盖；来者不知道
 *     （null / 非数字）而库里已知时不覆盖；库里未知时照写。
 *   C 写回执的行组严格时间：来者严格新才覆盖；持平按到达序写（同秒已知局限）；来者更旧时整笔回执
 *     都不写（不撤销更新的回执）。5 秒回执优先窗仍是第二道护栏：窗口内即使来者更新时间更新也让给回执。
 *   D 版本门按组跳过：过期组只跳过它自己，同批其余组照写；全部组都被跳过时不开新版本、不回 stale。
 *     同步世代门不匹配仍是整批丢弃（reason:'stale' 只留给它）。
 *
 * 票面第 4 条还有一半在客户端（整份取数回来的是更旧的一份时不许装、不许记成新基线），
 * 那一组的现场在 tests/verify-1891-version-sync.ts 的 I 组：本文件只守库这一侧，
 * 客户端那一片不属于 workspace-snapshot 的归属。
 *
 * 为什么用真 SQLite：「同一个快照」「另一条连接提交」「事务回滚」这些行为只有真库才有；替身会
 * 把要证的结论写进替身的实现里。临时目录用 os.tmpdir()，每趟结束删干净。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1931-read-snapshot.ts
 */
// 门禁归属: src/workspace-snapshot/persistence/read-transaction.ts
// 门禁归属: src/workspace-snapshot/projection/list.ts
// 门禁归属: src/workspace-snapshot/projection/detail.ts
// 门禁归属: src/workspace-snapshot/projection/changes.ts
// 门禁归属: src/workspace-snapshot/projection/counts.ts
// 门禁归属: src/workspace-snapshot/merge/row.ts
// 门禁归属: src/workspace-snapshot/merge/version-gate.ts
// 门禁归属: src/workspace-snapshot/runtime/ingest.ts
// 门禁归属: src/workspace-snapshot/runtime/open.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import { ingestWrites } from '../src/workspace-snapshot/runtime/ingest.ts'
import { markMissingTickets } from '../src/workspace-snapshot/runtime/tombstone-write.ts'
import { shouldApplyRowTime } from '../src/workspace-snapshot/merge/row.ts'
import { isGroupStale } from '../src/workspace-snapshot/merge/version-gate.ts'
import { SNAPSHOT_RECEIPT_PRIORITY_MS } from '../src/shared/time-config/src/values.js'
import type {
  IssueGroupsWrite,
  IssueWrite,
  OpenWorkspaceSnapshotResult,
  WorkspaceSnapshotHandle,
} from '../src/workspace-snapshot/contract/types.ts'
import type { GroupCompleteness, IssueRowValue } from '../src/workspace-snapshot/model/types.ts'

const GATE = 'verify-1931-read-snapshot'
const CLOCK = 1762500000000
const EFFORT = 'effort-1'
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

/** 行组的完整值；updatedAtMs 是这一票在本票里被严格比较的那一格。 */
function rowValue(patch: Partial<IssueRowValue>): IssueRowValue {
  return Object.assign({
    type: 'issue', title: null, state: 'open', url: null,
    createdAtMs: null, updatedAtMs: null, closedAtMs: null, stateReason: null,
    isPullRequest: false, commentCount: null, milestoneJson: null, customFieldsJson: null,
    status: null, statusVisible: null, statusSource: null, statusConflictJson: null,
  }, patch)
}

function rowGroup(value: IssueRowValue | null, completeness: GroupCompleteness = 'complete'): IssueGroupsWrite['row'] {
  return { completeness, value, source: 'gate', operation: 'get' }
}

function write(key: string, groups: IssueGroupsWrite): IssueWrite {
  return { effortId: EFFORT, key, groups }
}

function byKey(result: { issues: Array<{ key: string }> }, key: string): any {
  return result.issues.filter((item) => item.key === key)[0]
}

/** 门禁在投影事务中间要执行的那一笔写：stage 是投影里报出来的稳定步骤名。 */
interface Injection {
  stage: string
  run: () => void
}

/**
 * 用第二个连接真写一笔。它与「正在读的这一个句柄」是两个连接，这才是并发写者该有的样子；
 * 用同一个连接写会并进读事务里，证不出「另一个写者提交了，这次投影仍看旧快照」。
 */
function injectWrites(dbPath: string, writes: IssueWrite[], startMergeVersion: number, sync?: unknown): void {
  const other = new DatabaseSync(dbPath)
  try {
    other.exec('PRAGMA busy_timeout = 2000')
    const result = ingestWrites(other, writes, startMergeVersion, CLOCK, (sync ?? null) as any, 'read')
    if (result.committed !== true) {
      throw new Error('门禁注入的那一笔写没有提交：' + JSON.stringify(result))
    }
  } finally {
    other.close()
  }
}

/** 用第二个连接真写一条墓碑（变化集那一组要它）。 */
function injectMissing(dbPath: string, key: string, startMergeVersion: number): void {
  const other = new DatabaseSync(dbPath)
  try {
    other.exec('PRAGMA busy_timeout = 2000')
    const result = markMissingTickets(other, [{ effortId: EFFORT, key }], startMergeVersion, CLOCK)
    if (result.committed !== true || result.marked !== 1) {
      throw new Error('门禁注入的墓碑没有写进去：' + JSON.stringify(result))
    }
  } finally {
    other.close()
  }
}

/**
 * 开一个干净的真库给某一组用。每组各一份库，互不串味；workspace.yaml 不写，路径按传进来的 dbPath。
 * now 可注入：B/C 两组要按毫秒推进时钟来验「更新时间」与回执窗口的边界。
 */
function openGateDb(
  tempRoot: string,
  name: string,
  options?: { now?: () => number, onReadStep?: (stage: string) => void },
): { handle: WorkspaceSnapshotHandle, dbPath: string } {
  const workspaceDir = path.join(tempRoot, 'ws-' + name)
  mkdirSync(workspaceDir, { recursive: true })
  const dbPath = path.join(tempRoot, 'db-' + name, 'snapshot.sqlite')
  const opened: OpenWorkspaceSnapshotResult = openWorkspaceSnapshot({
    workspaceRoot: workspaceDir,
    backend: 'markdown',
    repoIdentity: 'repo-a-' + name,
    dbPath,
    now: (options && options.now) || (() => CLOCK),
    leaseOwner: 'gate-1931-' + name,
    ...(options && options.onReadStep ? { onReadStep: options.onReadStep } : null),
  } as any)
  return { handle: opened.handle, dbPath }
}

/**
 * A 组：读事务一致。
 *
 * 预置四张票（A 行 + 标签 + 正文、B 行、地图 MAP、挂在 MAP 下的 CHILD），然后逐条投影各做一次
 * 「读到一半有另一个写者提交」的现场：钩子在投影的事务内、第一条查询之后被调用，注入一笔真写。
 * 断言分两半，缺一不可：
 *   ① 同一次投影里版本与数据必须同属写之前那一份（另一半是「注入真的落地了」，否则①是空转）；
 *   ② 紧接着的下一次投影必须看见新版本与新值。
 */
function sectionA(tempRoot: string): void {
  let injection: Injection | null = null
  const { handle, dbPath } = openGateDb(tempRoot, 'a', {
    onReadStep: (stage: string) => {
      const job = injection
      if (!job || job.stage !== stage) return
      injection = null
      job.run()
    },
  })

  const seed = handle.ingest({
    startMergeVersion: 0,
    writes: [
      write('A', {
        row: rowGroup(rowValue({ title: '甲（旧）', updatedAtMs: 1000 })),
        labels: { completeness: 'complete', value: [{ name: 'old' }] },
        body: { completeness: 'complete', value: '旧正文' },
      }),
      write('B', { row: rowGroup(rowValue({ title: '乙（旧）', updatedAtMs: 1000 })) }),
      write('MAP', { row: rowGroup(rowValue({ type: 'map', title: '地图（旧）', updatedAtMs: 1000 })) }),
      write('CHILD', {
        row: rowGroup(rowValue({ title: '子票', updatedAtMs: 1000 })),
        parents: { completeness: 'complete', value: ['MAP'] },
      }),
    ],
  })
  check(seed.committed === true && handle.getMergeVersion() === 1, 'A0 预置四张票，库版本 1', seed)

  // ---- 列表投影 ----
  const beforeList = handle.getMergeVersion()
  injection = {
    stage: 'list-after-rows',
    run: () => injectWrites(dbPath, [write('A', {
      row: rowGroup(rowValue({ title: '甲（新）', updatedAtMs: 5000 })),
      labels: { completeness: 'complete', value: [{ name: 'new' }] },
    })], beforeList),
  }
  const mixedList = handle.readList({ state: 'all' })
  const mixedA = byKey(mixedList, 'A')
  check(
    mixedList.mergeVersion === beforeList && mixedA.row.title === '甲（旧）'
      && mixedA.labels.length === 1 && mixedA.labels[0].name === 'old',
    'A1 列表投影：事务中间提交的那一笔写不进这次投影（版本、行、标签都还是写之前那一份）',
    { version: mixedList.mergeVersion, title: mixedA.row.title, labels: mixedA.labels.map((x: any) => x.name) },
  )
  const freshList = handle.readList({ state: 'all' })
  const freshA = byKey(freshList, 'A')
  check(
    freshList.mergeVersion === beforeList + 1 && freshA.row.title === '甲（新）'
      && freshA.labels[0].name === 'new',
    'A2 紧接着的下一次投影看见新版本与新值（A1 的注入确实落了地，不是空转）',
    { version: freshList.mergeVersion, title: freshA.row.title, labels: freshA.labels.map((x: any) => x.name) },
  )

  // ---- 详情投影 ----
  const beforeDetail = handle.getMergeVersion()
  injection = {
    stage: 'detail-after-row',
    run: () => injectWrites(dbPath, [write('A', {
      body: { completeness: 'complete', value: '新正文' },
      labels: { completeness: 'complete', value: [{ name: 'newer' }] },
    })], beforeDetail),
  }
  const mixedDetail = handle.readIssueDetail({ key: 'A', effortId: EFFORT })
  check(
    mixedDetail.mergeVersion === beforeDetail && !!mixedDetail.issue
      && mixedDetail.issue.body === '旧正文' && mixedDetail.issue.labels[0].name === 'new',
    'A3 详情投影：事务中间的写不进这次投影（版本、正文、标签同属写之前那一份）',
    { version: mixedDetail.mergeVersion, body: mixedDetail.issue && mixedDetail.issue.body, labels: mixedDetail.issue && mixedDetail.issue.labels.map((x: any) => x.name) },
  )
  const freshDetail = handle.readIssueDetail({ key: 'A', effortId: EFFORT })
  check(
    freshDetail.mergeVersion === beforeDetail + 1 && !!freshDetail.issue
      && freshDetail.issue.body === '新正文' && freshDetail.issue.labels[0].name === 'newer',
    'A4 下一次读详情看见新正文与新标签',
    { version: freshDetail.mergeVersion, body: freshDetail.issue && freshDetail.issue.body },
  )

  // ---- 容器投影 ----
  const beforeContainer = handle.getMergeVersion()
  injection = {
    stage: 'container-after-rows',
    run: () => injectWrites(dbPath, [write('MAP', {
      labels: { completeness: 'complete', value: [{ name: 'late' }] },
    })], beforeContainer),
  }
  const mixedContainer = handle.readContainerProjection({ key: 'MAP', effortId: EFFORT })
  check(
    mixedContainer.mergeVersion === beforeContainer && !!mixedContainer.container
      && mixedContainer.container.labels.length === 0
      && mixedContainer.issues.length === 1 && mixedContainer.issues[0].key === 'CHILD',
    'A5 容器投影：容器行、子票行与版本同属写之前那一份（中间写的标签不出现）',
    { version: mixedContainer.mergeVersion, labels: mixedContainer.container && mixedContainer.container.labels, children: mixedContainer.issues.map((x: any) => x.key) },
  )
  const freshContainer = handle.readContainerProjection({ key: 'MAP', effortId: EFFORT })
  check(
    freshContainer.mergeVersion === beforeContainer + 1
      && freshContainer.container.labels.length === 1 && freshContainer.container.labels[0].name === 'late',
    'A6 下一次读容器看见刚写进去的标签',
    freshContainer.container && freshContainer.container.labels,
  )

  // ---- 变化集投影 ----
  // since 取「当前版本 - 1」，变化集才会真的去查变化行与墓碑；注入的是一条墓碑。
  const beforeChanges = handle.getMergeVersion()
  const since = beforeChanges - 1
  injection = {
    stage: 'changes-after-rows',
    run: () => injectMissing(dbPath, 'B', beforeChanges),
  }
  const mixedChanges = handle.readChangeSet({ sinceVersion: since })
  check(
    mixedChanges.mergeVersion === beforeChanges && mixedChanges.missing.length === 0
      && mixedChanges.full === false,
    'A7 变化集投影：事务中间写下的墓碑不进这次结果（版本与墓碑同属写之前那一份）',
    { version: mixedChanges.mergeVersion, missing: mixedChanges.missing },
  )
  const freshChanges = handle.readChangeSet({ sinceVersion: since })
  check(
    freshChanges.mergeVersion === beforeChanges + 1
      && freshChanges.missing.length === 1 && freshChanges.missing[0].key === 'B',
    'A8 下一次读变化集看见那条墓碑',
    freshChanges.missing,
  )

  // ---- 计数投影 ----
  // 六个数字与「整仓完整枚举时刻」是两条查询；注入的那一笔同时改这两样，才能验出它们同属一个快照。
  const beforeCounts = handle.readCounts()
  const beforeCountsVersion = handle.getMergeVersion()
  injection = {
    stage: 'counts-after-total',
    run: () => injectWrites(dbPath, [write('NEW', {
      row: rowGroup(rowValue({ title: '新的票', updatedAtMs: 2000 })),
    })], beforeCountsVersion, { fullEnumerationMs: CLOCK }),
  }
  const mixedCounts = handle.readCounts()
  check(
    beforeCounts.completeness === 'known' && mixedCounts.completeness === 'known'
      && mixedCounts.total === beforeCounts.total,
    'A9 计数投影：事务中间写下的「整仓完整枚举时刻」与新增行都不进这次结果（数字与完整度同一时刻）',
    { before: beforeCounts, after: mixedCounts },
  )
  const freshCounts = handle.readCounts()
  check(
    freshCounts.completeness === 'complete' && freshCounts.total === beforeCounts.total + 1,
    'A10 下一次读计数看见新行与新的完整度',
    freshCounts,
  )

  handle.close()
}


/**
 * B 组：读结果的行组严格时间。
 *
 * 现场：库里某张票的行组记着 updatedAt=1000。来一趟读结果，它的更新时间可能更旧、持平、更新、
 * 或者根本不知道。规则只有一条：**严格更新才覆盖**（未知不覆盖已知，已知可以填未知）。
 * 为什么：后端会给同一张票返回同一时刻的两个版本（分页与重取之间），谁最后到谁赢的话，
 * 「刚看到新标题」会在下一秒被一份同时刻的旧回包顶回去。同理，本地 Markdown 的 mtime 精度只有秒，
 * 同一秒内的两次写不能用「到达顺序」赌对错 —— 持平就不动，等真正更新的那一份来。
 *
 * 本组同时验两件配套的事：被时间挡下的只有 row 这一组（同批的标签照写），
 * 且整批一组都没写进去时不推进库版本（什么都不写却加版本会让界面以为有变化）。
 */
function sectionB(tempRoot: string): void {
  let clock = CLOCK
  const { handle } = openGateDb(tempRoot, 'b', { now: () => clock })
  const seed = handle.ingest({
    startMergeVersion: 0,
    writes: [write('A', {
      row: rowGroup(rowValue({ title: '旧标题', updatedAtMs: 1000 })),
      labels: { completeness: 'complete', value: [{ name: 'old' }] },
    })],
  })
  check(seed.committed === true, 'B0 预置一张 updatedAt=1000 的票', seed)
  const seededRowQueriedAt = handle.readIssueDetail({ key: 'A', effortId: EFFORT }).issue.groups.row.lastQueriedMs

  // ---- 更旧：只跳过 row 组，同批的标签照写 ----
  clock = CLOCK + 1000
  const older = handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    writes: [write('A', {
      row: rowGroup(rowValue({ title: '更旧的标题', updatedAtMs: 500 })),
      labels: { completeness: 'complete', value: [{ name: 'newer' }] },
    })],
  })
  const afterOlder = handle.readIssueDetail({ key: 'A', effortId: EFFORT }).issue
  check(
    older.committed === true && afterOlder.row.title === '旧标题' && afterOlder.row.updatedAtMs === 1000,
    'B1 来者的更新时间更旧：row 组不覆盖（库里仍是 old 标题与 1000）',
    { committed: older.committed, title: afterOlder.row.title, updatedAtMs: afterOlder.row.updatedAtMs },
  )
  check(
    afterOlder.labels.length === 1 && afterOlder.labels[0].name === 'newer',
    'B2 同一批里没被时间挡下的标签组照写（按组判，不是整条丢）',
    afterOlder.labels,
  )
  check(
    afterOlder.groups.row.lastQueriedMs === seededRowQueriedAt,
    'B3 被时间挡下的 row 组不盖新的取数章（否则界面会以为这一组刚被重新确认过）',
    { before: seededRowQueriedAt, after: afterOlder.groups.row.lastQueriedMs },
  )

  // ---- 持平：不覆盖 ----
  clock = CLOCK + 2000
  const versionBeforeTie = handle.getMergeVersion()
  const tie = handle.ingest({
    startMergeVersion: versionBeforeTie,
    writes: [write('A', { row: rowGroup(rowValue({ title: '持平标题', updatedAtMs: 1000 })) })],
  })
  check(
    tie.committed === true && handle.readIssueDetail({ key: 'A', effortId: EFFORT }).issue.row.title === '旧标题'
      && handle.getMergeVersion() === versionBeforeTie && tie.skippedGroups === undefined,
    'B4 更新时间持平：不覆盖；一组都没写进去时库版本不前进，也不记成「版本门跳过」',
    { result: tie, version: handle.getMergeVersion() },
  )

  // ---- 更新：覆盖 ----
  clock = CLOCK + 3000
  const newer = handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    writes: [write('A', { row: rowGroup(rowValue({ title: '新标题', updatedAtMs: 2000 })) })],
  })
  const afterNewer = handle.readIssueDetail({ key: 'A', effortId: EFFORT }).issue
  check(
    newer.committed === true && afterNewer.row.title === '新标题' && afterNewer.row.updatedAtMs === 2000,
    'B5 来者的更新时间严格更新：覆盖',
    { title: afterNewer.row.title, updatedAtMs: afterNewer.row.updatedAtMs },
  )

  // ---- 来者不知道、库里已知：不覆盖 ----
  const unknownTime = handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    writes: [write('A', { row: rowGroup(rowValue({ title: '没有时间的标题', updatedAtMs: null })) })],
  })
  check(
    unknownTime.committed === true
      && handle.readIssueDetail({ key: 'A', effortId: EFFORT }).issue.row.title === '新标题',
    'B6 来者不知道更新时间而库里已知：不覆盖（不知道 ≠ 更新）',
    handle.readIssueDetail({ key: 'A', effortId: EFFORT }).issue.row.title,
  )

  // ---- 库里未知、来者已知：写 ----
  handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    writes: [write('C', { row: rowGroup(rowValue({ title: '从没取过时间', updatedAtMs: null })) })],
  })
  const fillTime = handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    writes: [write('C', { row: rowGroup(rowValue({ title: '有了时间', updatedAtMs: 800 })) })],
  })
  const afterFill = handle.readIssueDetail({ key: 'C', effortId: EFFORT }).issue
  check(
    fillTime.committed === true && afterFill.row.title === '有了时间' && afterFill.row.updatedAtMs === 800,
    'B7 库里不知道更新时间、来者知道：照写（已知可以填未知）',
    { title: afterFill.row.title, updatedAtMs: afterFill.row.updatedAtMs },
  )

  // ---- 纯判断的边界 ----
  check(
    shouldApplyRowTime(5, 4, 'read') === true && shouldApplyRowTime(4, 4, 'read') === false
      && shouldApplyRowTime(3, 4, 'read') === false,
    'B8 纯判断：读结果严格更新才覆盖，持平与更旧都不覆盖',
  )
  check(
    shouldApplyRowTime(null, 4, 'read') === false && shouldApplyRowTime(5, null, 'read') === true
      && shouldApplyRowTime(null, null, 'read') === true,
    'B9 纯判断：未知不覆盖已知；已知覆盖未知；两边都未知时照写',
  )
  check(
    shouldApplyRowTime(Number.NaN, 4, 'read') === false && shouldApplyRowTime(-1, 4, 'read') === false,
    'B10 纯判断：非有限数与负数都按「不知道」处理，不许拿坏值当更新',
  )

  // ---- E. 生产接线：startMergeVersion 必须在读开始前取好 ----
  // 版本门挡的是「读开始之后、写之前」的提交；如果写的时候才读当前版本，那段时间里发生的写
  // 都已经包含在当前版本里，门永远不会命中。这里用源码接线断言把三条读路钉住（行为已在 D 组用真库验过）。
  const firstScreenSrc = readFileSync(path.join(process.cwd(), 'src/refresh/rooms/host/snapshot-library-first-screen.ts'), 'utf8')
  check(
    firstScreenSrc.includes('startMergeVersion') && firstScreenSrc.includes('replay.mergeVersion')
      && firstScreenSrc.includes('payload.startMergeVersion = startMergeVersion'),
    'E1 首屏：起点版本取自回放（或请求前读一次），并交给 recordIssueRows',
  )
  const refreshSrc = readFileSync(path.join(process.cwd(), 'src/refresh/rooms/host/session-refresh-schedule.ts'), 'utf8')
  check(
    refreshSrc.includes('prevScreen && prevScreen.replay ? prevScreen.replay.mergeVersion : undefined')
      && refreshSrc.includes('persistRefreshRows(cwd, backendId, repoRef, prevScreen && prevScreen.replay')
      && refreshSrc.includes('persistRefreshRows(cwd, backendId2, repoRef2, prevScreen2 && prevScreen2.replay'),
    'E2 强制刷新：两条支路都把回放起点版本交给 recordIssueRows',
  )
  const commentSrc = readFileSync(path.join(process.cwd(), 'src/refresh/rooms/host/comment-thread-fetch.ts'), 'utf8')
  check(
    commentSrc.includes('const startMergeVersion: number | null = await libraryVersionOf(lib, libKey)')
      && commentSrc.includes('payload.startMergeVersion = startMergeVersion'),
    'E3 详情与评论页：发请求前读库版本，写库时带上它',
  )

  handle.close()
}


/**
 * C 组：写回执的行组严格时间，以及「回执优先窗仍是第二道护栏」。
 *
 * 写回执与读结果不是同一种东西：回执说的是「我刚把它改成了这样」，它自己是刚写完的真状态，
 * 所以同一毫秒里两次回执按到达顺序落（后到的那次就是更新的那次）。而一份**比库里更旧**的回执
 * （例如一次重放、一次延迟的重试）不能撤销更新的回执：它带来的整张票一个组都不写。
 *
 * 第二道护栏仍在：回执表达过的组在 5 秒窗口内不被读结果覆盖。这里的现场特意让迟到的读结果
 * 更新时间**更新** —— 时间是第一道，窗口是第二道；窗口内即使来者更新时间更新也要让给回执，
 * 因为那一趟读是从写之前的状态开始读的（版本门对它的无能为力见 merge/receipt-priority.ts）。
 */
function sectionC(tempRoot: string): void {
  let clock = CLOCK
  const { handle } = openGateDb(tempRoot, 'c', { now: () => clock })
  const seed = handle.ingest({
    startMergeVersion: 0,
    writes: [write('R', {
      row: rowGroup(rowValue({ title: '旧标题', updatedAtMs: 1000 })),
      labels: { completeness: 'complete', value: [{ name: 'old' }] },
    })],
  })
  check(seed.committed === true, 'C0 预置一张 updatedAt=1000、标签 old 的票', seed)

  // ---- 更旧的回执：整张票一个组都不写 ----
  clock = CLOCK + 1000
  const versionBeforeOldReceipt = handle.getMergeVersion()
  const oldReceipt = handle.ingest({
    startMergeVersion: versionBeforeOldReceipt,
    kind: 'receipt',
    writes: [write('R', {
      row: rowGroup(rowValue({ title: '更旧的回执标题', updatedAtMs: 500 })),
      labels: { completeness: 'complete', value: [{ name: 'receipt-old' }] },
    })],
  })
  const afterOldReceipt = handle.readIssueDetail({ key: 'R', effortId: EFFORT }).issue
  check(
    oldReceipt.committed === true && afterOldReceipt.row.title === '旧标题'
      && afterOldReceipt.labels.length === 1 && afterOldReceipt.labels[0].name === 'old'
      && handle.getMergeVersion() === versionBeforeOldReceipt,
    'C1 回执比库里更旧：整张票这一笔一个组都不写（row 与同批的 labels 都不动），库版本不前进',
    { result: oldReceipt, title: afterOldReceipt.row.title, labels: afterOldReceipt.labels, version: handle.getMergeVersion() },
  )

  // ---- 同秒持平的回执：写，并记下同秒局限 ----
  clock = CLOCK + 2000
  const tieReceipt = handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    kind: 'receipt',
    writes: [write('R', { row: rowGroup(rowValue({ title: '持平的回执标题', updatedAtMs: 1000 })) })],
  })
  const afterTie = handle.readIssueDetail({ key: 'R', effortId: EFFORT }).issue
  check(
    tieReceipt.committed === true && afterTie.row.title === '持平的回执标题' && tieReceipt.sameSecondTie === true,
    'C2 回执与库里更新时间持平：按到达序写（回执是刚写完的真状态），结果里带 sameSecondTie 供排查',
    { result: tieReceipt, title: afterTie.row.title },
  )

  // ---- 更新的回执：写，且不是持平 ----
  clock = CLOCK + 3000
  const freshReceipt = handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    kind: 'receipt',
    writes: [write('R', { row: rowGroup(rowValue({ title: '更新的回执标题', updatedAtMs: 4000 })) })],
  })
  const afterFresh = handle.readIssueDetail({ key: 'R', effortId: EFFORT }).issue
  check(
    freshReceipt.committed === true && afterFresh.row.title === '更新的回执标题'
      && freshReceipt.sameSecondTie === undefined,
    'C3 回执比库里更新：照写，且不误报成同秒持平',
    { result: freshReceipt, title: afterFresh.row.title },
  )

  // ---- 窗口是第二道：窗口内即使更新时间更新也让给回执 ----
  clock = CLOCK + 4000
  const receiptAt = clock
  const windowReceipt = handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    kind: 'receipt',
    writes: [write('W', {
      row: rowGroup(rowValue({ title: '回执标题', updatedAtMs: 9000 })),
    })],
  })
  check(windowReceipt.committed === true, 'C4 回执先提交进库（窗口从这一刻开始算）', windowReceipt)
  clock = receiptAt + 1000
  handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    writes: [write('W', { row: rowGroup(rowValue({ title: '迟到的读标题', updatedAtMs: 9000 + 1000 })) })],
  })
  check(
    handle.readIssueDetail({ key: 'W', effortId: EFFORT }).issue.row.title === '回执标题',
    'C5 窗口内：即使来者的更新时间更新，读结果也让给回执（时间是第一道，窗口是第二道）',
    handle.readIssueDetail({ key: 'W', effortId: EFFORT }).issue.row.title,
  )
  clock = receiptAt + SNAPSHOT_RECEIPT_PRIORITY_MS
  handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    writes: [write('W', { row: rowGroup(rowValue({ title: '迟到的读标题', updatedAtMs: 9000 + 1000 })) })],
  })
  check(
    handle.readIssueDetail({ key: 'W', effortId: EFFORT }).issue.row.title === '迟到的读标题',
    'C6 窗口一过（正好 ' + SNAPSHOT_RECEIPT_PRIORITY_MS + ' 毫秒）：晚到的读结果照常覆盖',
    handle.readIssueDetail({ key: 'W', effortId: EFFORT }).issue.row.title,
  )

  handle.close()
}


/**
 * D 组：版本门按组跳过。
 *
 * 改动前：本批表达的组里只要有一组的 written_version 大于起读版本，整批 ROLLBACK。
 * 改动后：#1931 起只跳过过期的那几组，其余组照写；全部组都被跳过时不推进版本、也不回 stale。
 *
 * 为什么要改：一次整份刷新会带回几十张票，其中一张的行组可能刚好被另一个写者更新过。
 * 整批丢弃会让调用方拿旧数据重试一遍（把刚写对的值又写回去），而按组跳过只丢真正过期的组。
 * reason:'stale' 从这一票起只留给同步世代门（sync.expectedGeneration 不匹配）—— 那一条仍是整批丢。
 */
function sectionD(tempRoot: string): void {
  const { handle } = openGateDb(tempRoot, 'd')
  const seed = handle.ingest({
    startMergeVersion: 0,
    writes: [write('A', {
      row: rowGroup(rowValue({ title: '甲', updatedAtMs: 1000 })),
      labels: { completeness: 'complete', value: [{ name: 'v1-label' }] },
      body: { completeness: 'complete', value: '第一版正文' },
    })],
  })
  // 再写一次标签：标签组的 written_version 推到 2，正文组还停在 1。
  const touchLabels = handle.ingest({
    startMergeVersion: 1,
    writes: [write('A', { labels: { completeness: 'complete', value: [{ name: 'v2-label' }] } })],
  })
  check(
    seed.committed === true && touchLabels.committed === true && handle.getMergeVersion() === 2,
    'D0 预置：标签组写在版本 2，正文组停在版本 1',
    { seed, touchLabels, version: handle.getMergeVersion() },
  )

  // ---- 混合批：过期的标签组被跳过，正文组照写 ----
  const mixed = handle.ingest({
    startMergeVersion: 1,
    writes: [write('A', {
      labels: { completeness: 'complete', value: [{ name: '迟到的标签' }] },
      body: { completeness: 'complete', value: '迟到的正文' },
    })],
  })
  const afterMixed = handle.readIssueDetail({ key: 'A', effortId: EFFORT }).issue
  check(
    mixed.committed === true && mixed.skippedGroups === 1
      && afterMixed.labels.length === 1 && afterMixed.labels[0].name === 'v2-label'
      && afterMixed.body === '迟到的正文',
    'D1 混合批：过期的标签组被跳过（值不动）、同批正文组照写，skippedGroups 记 1',
    { result: mixed, labels: afterMixed.labels, body: afterMixed.body },
  )
  check(
    mixed.committed === true && handle.getMergeVersion() === 3 && mixed.reason === undefined,
    'D2 混合批仍然提交并推进一版；reason 不是 stale（数据写入不再回 stale）',
    { version: handle.getMergeVersion(), reason: mixed.reason },
  )

  // ---- 全部组都被跳过：不开新版本、不回 stale ----
  const versionBeforeAllStale = handle.getMergeVersion()
  const allStale = handle.ingest({
    startMergeVersion: 1,
    writes: [write('A', { labels: { completeness: 'complete', value: [{ name: '全过期的标签' }] } })],
  })
  const afterAllStale = handle.readIssueDetail({ key: 'A', effortId: EFFORT }).issue
  check(
    allStale.committed === true && allStale.skippedGroups === 1
      && handle.getMergeVersion() === versionBeforeAllStale
      && afterAllStale.labels[0].name === 'v2-label',
    'D3 全部组都被跳过：committed:true、版本不前进、不回 reason:stale（回 stale 会让调用方把旧数据再写一遍）',
    { result: allStale, version: handle.getMergeVersion(), labels: afterAllStale.labels },
  )

  // ---- 同步世代门：仍是整批丢弃 ----
  const generation = handle.ingest({
    startMergeVersion: handle.getMergeVersion(),
    writes: [write('A', { body: { completeness: 'complete', value: '世代不符的正文' } })],
    sync: { expectedGeneration: 99 },
  } as any)
  check(
    generation.committed === false && generation.reason === 'stale' && generation.detail === 'generation'
      && handle.readIssueDetail({ key: 'A', effortId: EFFORT }).issue.body === '迟到的正文',
    'D4 同步世代号对不上：仍然整批丢弃、回 stale（detail 说清是世代门），库里一个字节不改',
    { result: generation, body: handle.readIssueDetail({ key: 'A', effortId: EFFORT }).issue.body },
  )

  // ---- 纯判断的边界 ----
  check(
    isGroupStale(3, 4) === true && isGroupStale(3, 3) === false && isGroupStale(3, 2) === false,
    'D5 纯判断：written_version 严格大于起点才算这一组过期',
  )
  check(
    isGroupStale(3, null) === false && isGroupStale(3, undefined) === false
      && isGroupStale(3, Number.NaN) === false && isGroupStale(Number.NaN, 1) === true,
    'D6 纯判断：没有写入记录（null/undefined/坏值）不算过期；非法起点归一成 0',
  )

  handle.close()
}

function main(): void {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1931-'))
  try {
    sectionA(tempRoot)
    sectionB(tempRoot)
    sectionC(tempRoot)
    sectionD(tempRoot)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }

  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 读快照一致与冲突规则门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main()
