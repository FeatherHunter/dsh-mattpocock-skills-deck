/**
 * tests/verify-1889-write-receipts.ts —— 写路径全覆盖与回执优先窗口（#1889，规格 #1885 §8）
 *
 * 守什么（票面五条验收逐条落在这里）：
 *   ① 写路径清单列全，逐条标注「经库 / 不经库 / 不适用」：清单就是本文件顶上的 WRITE_PATH_INVENTORY，
 *      它与操作百科（src/tracker/contract/operations-encyclopedia.ts）的每一条写操作逐条对账——
 *      缺一条、分类写错、组名不在库里、没有证据，都在 A 组判红。
 *   ② 清单里所有「经库」的路径都先提交再更新界面、失败不留半写：B 组逐类把写回执写进真库、读回值，
 *      并断言提交推进了版本；C 组让整批在事务里失败，断言库里一个字节没改（值、版本都没动）。
 *   ③ 刚写完的票在窗口内被一次迟到的读结果撞上时，结论仍是写后的值：D 组用真 SQLite + 假时钟，
 *      先提交写回执，再让一趟「写之后才开始、却带着写之前的值」的读结果进来——按字段组判：
 *      回执表达过的组不倒退、没表达过的组照常更新；整票的删除表达（row=null）同样被挡。
 *   ④ 窗口长度住在时间参数里，不写死在代码里：E 组读 config/ttl.yaml 与生成常量、再打窗口边界——
 *      T+窗口-1 仍被挡、T+窗口 放行，边界与配置值逐毫秒对上。
 *   ⑤ 门禁覆盖清单上的每一类写：B 组覆盖行（状态/标题）、正文、标签、指派人、父子边、阻塞边、
 *      子票计数、合并信息、评论、评审十组，外加新建票；不是只覆盖今天已有回执的那三类。
 *
 * 为什么用真 SQLite：本票守的正是「写没写进库、挡没挡住」，内存替身测不出事务回滚、字段组粒度与
 * 关库重开；假时钟只替「现在几点」，不替库。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1889-write-receipts.ts
 */
// 门禁归属: src/workspace-snapshot/merge/receipt-priority.ts
// 门禁归属: src/workspace-snapshot/runtime/ingest.ts
// 门禁归属: src/workspace-snapshot/persistence/schema.ts
// 门禁归属: src/workspace-snapshot/persistence/migrate.ts
// 门禁归属: src/workspace-snapshot/contract/types.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-adapter.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { OPERATION_ENCYCLOPEDIA } from '../src/tracker/contract/operations-encyclopedia.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/runtime/open.ts'
import { SNAPSHOT_RECEIPT_PRIORITY_MS } from '../src/shared/time-config/src/values.js'
import {
  isReceiptWindowActive,
  shouldDeferReadGroup,
} from '../src/workspace-snapshot/merge/receipt-priority.ts'
import {
  closeSnapshotLibraries,
  readIssueDetail,
  recordCommentReceipt,
  recordIssueRows,
  recordWriteReceipt,
} from '../src/refresh/rooms/host/snapshot-library.ts'
import type { IssueGroupsWrite, IssueWrite } from '../src/workspace-snapshot/contract/types.ts'

const GATE = 'verify-1889-write-receipts'
let total = 0
let failed = 0
function check(ok: unknown, message: string, detail?: unknown): void {
  total += 1
  if (ok) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

// ---------------------------------------------------------------------------
// 写路径清单（票面第 1 条验收）
//
// behavior：library = 经库；outside = 不经库；na = 不适用。
// groups：这条路径落到快照库里的字段组（组名与 issue_group 里的物理名一致）。
// evidence：门禁名或代码位置——写在这里就要经得起核对，A 组会把每条路径与操作百科对一遍。
// ---------------------------------------------------------------------------
interface WritePathRow {
  id: string
  where: string
  behavior: 'library' | 'outside' | 'na'
  groups: string[]
  evidence: string
}

const LIBRARY_GROUPS = ['row', 'body', 'labels', 'assignees', 'parents', 'blockedBy', 'subIssues', 'mergeInfo', 'comments', 'review']

const WRITE_PATH_INVENTORY: WritePathRow[] = [
  // —— 跟踪器写操作（操作百科里的十一条）：全部经写事件 → 宿主补行 → 写回执这条异步路落库 ——
  { id: 'create', where: 'src/tracker/rooms/*/write + src/deck/tools/issue-create.ts', behavior: 'library', groups: ['row'], evidence: '本门禁 B11 + thin-row-fetch.ts 的 receipt 回调' },
  { id: 'close', where: 'src/deck/tools/issue-patch.ts → tracker.close', behavior: 'library', groups: ['row'], evidence: '本门禁 B1 + snapshot-library.ts 的 recordWriteReceipt' },
  { id: 'reopen', where: 'tracker.reopen（AI 工具面不允许，只由人在后端做）', behavior: 'library', groups: ['row'], evidence: '本门禁 B1 + issue-patch.ts 的重开拒绝分支（AI 工具面只允许关）' },
  { id: 'comment', where: 'src/deck/tools/issue-patch.ts → tracker.comment / 面板 handleCommentIssue', behavior: 'library', groups: ['comments'], evidence: '本门禁 B9 + verify-1866-write-receipt' },
  { id: 'update', where: 'src/deck/tools/issue-patch.ts → tracker.update（标题与正文）', behavior: 'library', groups: ['row', 'body', 'subIssues', 'mergeInfo'], evidence: '本门禁 B1/B2/B7/B8 + snapshot-library-adapter.ts 的 receiptIssueWriteOf' },
  { id: 'setLabels', where: 'src/deck/tools/issue-patch-labels.ts → tracker.setLabels', behavior: 'library', groups: ['labels'], evidence: '本门禁 B3 + verify-1866-write-receipt' },
  { id: 'setAssignees', where: 'src/deck/tools/issue-patch.ts → tracker.setAssignees', behavior: 'library', groups: ['assignees'], evidence: '本门禁 B4 + snapshot-library-adapter.ts 的 issueWriteOf（指派组）' },
  { id: 'setParent', where: 'src/deck/tools/map-link.ts → tracker.setParent', behavior: 'library', groups: ['parents'], evidence: '本门禁 B5 + snapshot-library-adapter.ts 的 parentsGroupOf' },
  { id: 'setBlockedBy', where: 'src/deck/tools/map-link.ts → tracker.setBlockedBy', behavior: 'library', groups: ['blockedBy'], evidence: '本门禁 B6 + snapshot-library-adapter.ts 的 blockedByGroupOf' },
  // 这三条是跟踪器侧的元数据写：回执没有票级字段，库不承接（票上的标签颜色仍随 labels 组入库）。
  { id: 'initProject', where: 'src/tracker/rooms/*/init-project.ts', behavior: 'outside', groups: [], evidence: '回执没有票级字段（操作百科 fieldGroups 为空）：库不承接' },
  { id: 'setLabelColors', where: 'src/tracker/rooms/*/label-colors*.ts', behavior: 'outside', groups: [], evidence: '标签定义是仓库级数据、不住库；票上的标签颜色仍随 labels 组写入' },
  { id: 'ensureLabelColorsFile', where: 'src/tracker/rooms/*/label-colors*.ts', behavior: 'outside', groups: [], evidence: '回执只有成功与否；写的是本地配色文件，不是票级数据' },
  // —— deck 工具入口（复合写，落到上面那几条跟踪器操作） ——
  { id: 'deck_issue_patch', where: 'src/deck/tools/issue-patch.ts', behavior: 'library', groups: ['row', 'body', 'labels', 'assignees', 'comments'], evidence: '本门禁 B1-B9 + row-patch.ts 的 patchTickets' },
  { id: 'deck_issue_create', where: 'src/deck/tools/issue-create.ts', behavior: 'library', groups: ['row'], evidence: '本门禁 B11 + write-event-subscription.ts（probe-now）' },
  { id: 'deck_map_link', where: 'src/deck/tools/map-link.ts', behavior: 'library', groups: ['parents', 'blockedBy'], evidence: '本门禁 B5/B6' },
  { id: 'deck_map_plan_create', where: 'src/deck/tools/map-plan-create.ts', behavior: 'library', groups: ['row', 'parents', 'blockedBy'], evidence: '本门禁 B5/B6/B11' },
  { id: 'deck_issue_report', where: 'src/deck/tools/issue-report.ts', behavior: 'na', groups: [], evidence: '在办表是会话私有数据，规格 D2 明确不进库' },
  // —— 宿主其它写路径 ——
  { id: 'panel-comment', where: 'src/refresh/rooms/host/comment-thread-fetch.ts → storeCommentReceipt', behavior: 'library', groups: ['comments'], evidence: 'verify-1866-write-receipt-replay + comment-thread-fetch.ts 的 storeCommentReceipt' },
  { id: 'publishFlow', where: 'src/host/publishFlow.ts', behavior: 'na', groups: [], evidence: '发布流程写的是 npm 注册表，不是工作区工单数据（规格 D2）：不经库' },
  { id: 'handoffClaim', where: 'src/host/handoffClaim.ts', behavior: 'na', groups: [], evidence: '会话交接是会话私有状态（规格 D2「不做」）：不进库' },
  { id: 'namingGuardian', where: 'src/host/namingGuardian.ts', behavior: 'na', groups: [], evidence: '命名持久化明确不进库（规格 D2）：不经库' },
  { id: 'pr-merge', where: '拉取请求合并（本仓没有发起合并的写路径，S7 另票）', behavior: 'na', groups: [], evidence: '合并信息由读结果的 mergeInfo 组表达；本门禁 B8 覆盖该组' },
]

/** 操作百科里所有写操作的名字：清单必须一条不漏地接住它们。 */
const TRACKER_WRITE_OPS: string[] = Object.keys(OPERATION_ENCYCLOPEDIA)
  .filter((name) => (OPERATION_ENCYCLOPEDIA as Record<string, { kind: string }>)[name].kind === 'write')

/**
 * 规格 §8 点名要覆盖的写类别（组名口径）：改状态与改标题都落在 row 组，合并落在 mergeInfo 组。
 * 正文（body）是 update 这条写的一份，一并要求；子票计数与评审不在 §8 的清单里，
 * 但 B 组仍然逐组测（门禁多覆盖不等于清单放宽）。
 */
const REQUIRED_GROUPS = ['row', 'body', 'labels', 'assignees', 'parents', 'blockedBy', 'mergeInfo', 'comments']

// ---------------------------------------------------------------------------
// 真库夹具
// ---------------------------------------------------------------------------
const CLOCK0 = 1762400000000
let clock = CLOCK0

const root = mkdtempSync(path.join(os.tmpdir(), 'verify-1889-'))
const dbPath = path.join(root, 'snapshot.sqlite')
const identity = { workspaceRoot: root, backend: 'github' as const, repoIdentity: 'acme/receipts' }
mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1889\n', 'utf8')

type Handle = ReturnType<typeof openWorkspaceSnapshot>['handle']
const opened = openWorkspaceSnapshot({ ...identity, dbPath, now: () => clock, leaseOwner: 'gate-1889' })
const handle: Handle = opened.handle
const libKey = { workspaceRoot: root, backend: 'github', repoIdentity: 'acme/receipts' }

/** 行组的完整值：只写这次真知道的字段，其余留 null（三态纪律：不知道 ≠ 空）。 */
function rowValue(title: string, state: string): Record<string, unknown> {
  return {
    type: 'issue', title, state, url: '', createdAtMs: null, updatedAtMs: null, closedAtMs: null,
    stateReason: null, isPullRequest: false, commentCount: null, milestoneJson: null,
    customFieldsJson: null, status: null, statusVisible: null, statusSource: null, statusConflictJson: null,
  }
}

function writeOf(key: string, groups: IssueGroupsWrite): IssueWrite {
  return { effortId: '', key, groups }
}

function completeGroup(value: unknown): any {
  return { completeness: 'complete', value }
}

/** 写一批（默认按读结果），回 ingest 结果；所有用例都从这一处走。 */
function ingest(writes: IssueWrite[], opts?: { kind?: 'read' | 'receipt', startMergeVersion?: number }): any {
  return handle.ingest({
    startMergeVersion: opts && opts.startMergeVersion !== undefined ? opts.startMergeVersion : handle.getMergeVersion(),
    writes,
    ...(opts && opts.kind ? { kind: opts.kind } : null),
  } as any)
}

function detailOf(key: string): any {
  const got = handle.readIssueDetail({ key, effortId: '' })
  return got.issue
}

/** tracker 契约的一张票：给宿主门面（recordWriteReceipt）用，字段够适配层换算即可。 */
function issueOf(key: string, extra?: Record<string, unknown>): any {
  return Object.assign({
    key, effortId: '', type: 'issue', title: '票 ' + key, state: 'open', body: '',
    url: 'https://github.com/acme/receipts/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', closedAt: null,
    parentKey: null, labels: [], assignees: [], blockedBy: [],
    fieldStates: {
      parents: { known: true, value: null, reason: null },
      dependencies: { known: true, value: [], reason: null },
      subIssues: { known: true, value: { total: 0, completed: 0, percentCompleted: 0 }, reason: null },
      comments: { known: true, value: 0, reason: null },
      review: { known: false, value: null, reason: 'not-applicable' },
      mergeInfo: { known: true, value: null, reason: null },
    },
  }, extra || {})
}

async function main(): Promise<void> {
  // ── A. 写路径清单：与操作百科逐条对账 ────────────────────────────────────────
  const listed = new Set(WRITE_PATH_INVENTORY.map((row) => row.id))
  const missingOps = TRACKER_WRITE_OPS.filter((op) => !listed.has(op))
  check(missingOps.length === 0, 'A1 操作百科里每一条写操作都在写路径清单里（缺：' + missingOps.join('、') + '）', missingOps)
  const opSet = new Set(TRACKER_WRITE_OPS)
  const misnamed = WRITE_PATH_INVENTORY.filter((row) => opSet.has(row.id) === false
    && ['create', 'close', 'reopen', 'comment', 'update', 'setLabels', 'setAssignees', 'setParent', 'setBlockedBy', 'initProject', 'setLabelColors'].indexOf(row.id) >= 0)
  check(misnamed.length === 0, 'A2 清单里的跟踪器写操作名字都在百科里（打错名字会让对账失效）', misnamed.map((row) => row.id))
  const badRows = WRITE_PATH_INVENTORY.filter((row) => (row.behavior !== 'library' && row.behavior !== 'outside' && row.behavior !== 'na')
    || !row.where || !row.evidence || !Array.isArray(row.groups))
  check(badRows.length === 0, 'A3 每一行都有合法分类（经库 / 不经库 / 不适用）、位置与证据', badRows.map((row) => row.id))
  const badGroups = WRITE_PATH_INVENTORY.filter((row) => row.groups.some((group) => LIBRARY_GROUPS.indexOf(group) < 0))
  check(badGroups.length === 0, 'A4 清单里的组名都是库里真实存在的组', badGroups.map((row) => ({ id: row.id, groups: row.groups })))
  const coveredGroups = new Set<string>()
  for (const row of WRITE_PATH_INVENTORY) if (row.behavior === 'library') for (const group of row.groups) coveredGroups.add(group)
  const uncovered = REQUIRED_GROUPS.filter((group) => !coveredGroups.has(group))
  check(uncovered.length === 0, 'A5 票面点名的写类别都被「经库」的路径覆盖（缺：' + uncovered.join('、') + '）', uncovered)
  const naWithoutReason = WRITE_PATH_INVENTORY.filter((row) => row.behavior === 'na' && row.evidence.length < 8)
  check(naWithoutReason.length === 0, 'A6 「不适用」的每一行都写了理由（不是空口不算）', naWithoutReason.map((row) => row.id))
  // 「不经库」不等于「漏了一条票级写」：真正的票级写都必须经库，不经库的只能是仓库级元数据
  // （标签定义、项目字段）——所以它们不许声称自己表达了任何票级字段组，且必须写明为什么。
  const outside = WRITE_PATH_INVENTORY.filter((row) => row.behavior === 'outside')
  const outsideBad = outside.filter((row) => row.groups.length !== 0 || row.evidence.length < 8)
  check(outsideBad.length === 0,
    'A7 「不经库」的三条都是仓库级元数据（不表达任何票级字段组），且都写了理由', outsideBad.map((row) => row.id))

  // ── B. 每一类写经库：回执提交之后读回来就是回执里的值（先落库，再谈界面） ──────
  const seed = ingest([writeOf('B', {
    row: completeGroup(rowValue('旧标题', 'open')),
    body: completeGroup('旧正文'),
    labels: completeGroup([{ name: 'old' }]),
    assignees: completeGroup([{ login: 'alice' }]),
    parents: completeGroup([]),
    blockedBy: completeGroup([]),
    subIssues: completeGroup({ total: 0, completed: 0, percent: 0 }),
    mergeInfo: completeGroup(null),
    comments: completeGroup([]),
    review: completeGroup([]),
  })], { kind: 'read' })
  check(seed.committed === true, 'B0 预置一张十组都取过的票（读结果）', seed)

  const classes: Array<{ title: string, groups: IssueGroupsWrite, expect: (detail: any) => boolean, what: string }> = [
    {
      title: 'B1 状态与标题（row 组）', groups: { row: completeGroup(rowValue('新标题', 'closed')) },
      expect: (d) => d.row.title === '新标题' && d.row.state === 'closed', what: '标题与状态',
    },
    { title: 'B2 正文（body 组）', groups: { body: completeGroup('新正文') }, expect: (d) => d.body === '新正文', what: '正文' },
    { title: 'B3 标签（labels 组）', groups: { labels: completeGroup([{ name: 'bug' }]) }, expect: (d) => d.labels.map((x: any) => x.name).join('|') === 'bug', what: '标签' },
    { title: 'B4 指派人（assignees 组）', groups: { assignees: completeGroup([{ login: 'bob' }]) }, expect: (d) => d.assignees.map((x: any) => x.login).join('|') === 'bob', what: '指派人' },
    { title: 'B5 父子边（parents 组）', groups: { parents: completeGroup(['P1']) }, expect: (d) => d.parents.map((x: any) => x.key).join('|') === 'P1', what: '父票' },
    { title: 'B6 阻塞边（blockedBy 组）', groups: { blockedBy: completeGroup(['BL1']) }, expect: (d) => d.blockedBy.map((x: any) => x.key).join('|') === 'BL1', what: '阻塞者' },
    { title: 'B7 子票计数（subIssues 组）', groups: { subIssues: completeGroup({ total: 3, completed: 1, percent: 33 }) }, expect: (d) => !!d.subIssues && d.subIssues.total === 3 && d.subIssues.completed === 1, what: '子票计数' },
    { title: 'B8 合并信息（mergeInfo 组）', groups: { mergeInfo: completeGroup(Date.parse('2026-11-02T00:00:00Z')) }, expect: (d) => d.mergedAtMs === Date.parse('2026-11-02T00:00:00Z'), what: '合并时间' },
    {
      title: 'B9 评论（comments 组，写回执追加一条）',
      groups: { commentReceipt: { comment: { body: '回执评论' }, position: null, completeness: 'complete' } } as any,
      expect: (d) => d.comments.map((x: any) => x.body).join('|').indexOf('回执评论') >= 0, what: '新评论',
    },
    { title: 'B10 评审（review 组）', groups: { review: completeGroup([{ state: 'approved' }]) }, expect: (d) => d.reviews.length === 1 && d.reviews[0].state === 'approved', what: '评审' },
  ]

  for (const item of classes) {
    const before = handle.getMergeVersion()
    const wrote = ingest([writeOf('B', item.groups)], { kind: 'receipt' })
    const after = detailOf('B')
    check(wrote.committed === true && after !== null && item.expect(after),
      item.title + '：回执提交之后库里读回来就是回执里的' + item.what,
      after === null ? wrote : { title: after.row.title, body: after.body, labels: after.labels.map((x: any) => x.name), assignees: after.assignees.map((x: any) => x.login), parents: after.parents.map((x: any) => x.key), blockedBy: after.blockedBy.map((x: any) => x.key), subIssues: after.subIssues, mergedAtMs: after.mergedAtMs, comments: after.comments.map((x: any) => x.body), reviews: after.reviews.map((x: any) => x.state) })
    check(wrote.committed === true && Number(wrote.mergeVersion) > before,
      item.title + '：提交推进了库版本（界面据此判新鲜度）', { before, after: wrote.mergeVersion })
  }

  const created = ingest([writeOf('NEW-1', { row: completeGroup(rowValue('新建票', 'open')) })], { kind: 'receipt' })
  const list = handle.readList({ state: 'all' })
  check(created.committed === true && list.issues.some((row: any) => row.key === 'NEW-1'),
    'B11 新建票（create）：回执落库之后立刻出现在列表投影里', list.issues.map((row: any) => row.key))

  // ── C. 失败不留半写：一批里有一笔不合法，整批回滚、版本不动 ────────────────────
  const versionBeforeFail = handle.getMergeVersion()
  const titleBeforeFail = detailOf('B').row.title
  const bad = ingest([
    writeOf('B', { row: completeGroup(rowValue('半写标题', 'closed')) }),
    writeOf('', { row: completeGroup(rowValue('缺票号', 'open')) }),
  ], { kind: 'receipt' })
  check(bad.committed === false, 'C1 一批里有一张票缺身份 → 整批不提交', bad)
  check(detailOf('B').row.title === titleBeforeFail && handle.getMergeVersion() === versionBeforeFail,
    'C2 整批没提交：那张票的标题没被改、库版本也没前进（没有半写）',
    { title: detailOf('B').row.title, version: handle.getMergeVersion() })

  // 宿主门面（异步）：它这一路上游是「写完之后 tracker 交回来的那张票」，落不成也要一个字节不改。
  const hostBad: any = await recordWriteReceipt({
    ...libKey,
    issues: [issueOf('B', { title: '门面失败标题' }), { effortId: '', key: '', title: '缺票号' }],
    operation: 'update',
  } as any)
  check(hostBad && hostBad.ok === false && detailOf('B').row.title === titleBeforeFail,
    'C3 宿主门面收到不合法的一批：回失败，库里旧值原样', hostBad)
  const badComment: any = await recordCommentReceipt({ ...libKey, keys: [], effortId: '', comment: { body: '没有主人的评论' } } as any)
  check(badComment && badComment.ok === false && detailOf('B').comments.map((x: any) => x.body).indexOf('没有主人的评论') < 0,
    'C4 评论回执没有票号：回失败，库里不多一条无主评论', badComment)

  // ── D. 回执优先窗口：迟到的读结果不得覆盖回执表达过的字段组 ────────────────────
  ingest([writeOf('W', {
    row: completeGroup(rowValue('窗口前标题', 'open')),
    labels: completeGroup([{ name: 'old' }]),
    body: completeGroup('窗口前正文'),
    parents: completeGroup([]),
    blockedBy: completeGroup([]),
  })], { kind: 'read' })
  clock = CLOCK0 + 1000
  const receiptAt = clock
  const receipt = ingest([writeOf('W', {
    row: completeGroup(rowValue('回执标题', 'closed')),
    labels: completeGroup([{ name: 'new' }]),
  })], { kind: 'receipt' })
  const versionAfterReceipt = Number(receipt.mergeVersion)
  check(receipt.committed === true && detailOf('W').row.title === '回执标题',
    'D1 写回执先提交进库（窗口从这里开始算）', receipt)

  const lateRead = ingest([writeOf('W', {
    row: completeGroup(rowValue('窗口前标题', 'open')),
    labels: completeGroup([{ name: 'old' }]),
    body: completeGroup('窗口后新正文'),
  })], { kind: 'read', startMergeVersion: versionAfterReceipt })
  const afterLate = detailOf('W')
  check(lateRead.committed === true, 'D2 迟到的读结果照常提交（只有被回执表达过的组被挡，不是整批丢）', lateRead)
  check(afterLate.row.title === '回执标题' && afterLate.row.state === 'closed',
    'D3 回执表达过的 row 组没有倒退：标题与状态仍是写后的值', { title: afterLate.row.title, state: afterLate.row.state })
  check(afterLate.labels.map((x: any) => x.name).join('|') === 'new',
    'D4 回执表达过的 labels 组没有倒退', afterLate.labels)
  check(afterLate.body === '窗口后新正文',
    'D5 回执没表达过的 body 组照常更新（按字段组判，不是按行整条挡）', afterLate.body)

  clock = receiptAt + SNAPSHOT_RECEIPT_PRIORITY_MS - 1
  const versionBeforeEdge = handle.getMergeVersion()
  const edgeRead = ingest([writeOf('W', { row: completeGroup(rowValue('边界前标题', 'open')) })], { kind: 'read' })
  check(edgeRead.committed === true && detailOf('W').row.title === '回执标题',
    'D6 窗口内的最后一毫秒：读结果仍被挡（回执的值不倒退）', detailOf('W').row.title)
  check(handle.getMergeVersion() === versionBeforeEdge,
    'D7 全部组都被挡时不开新版本（不让界面以为有变化）', { before: versionBeforeEdge, after: handle.getMergeVersion() })

  clock = receiptAt + SNAPSHOT_RECEIPT_PRIORITY_MS
  ingest([writeOf('W', { row: completeGroup(rowValue('窗口外标题', 'open')) })], { kind: 'read' })
  check(detailOf('W').row.title === '窗口外标题',
    'D8 窗口一到（正好 ' + SNAPSHOT_RECEIPT_PRIORITY_MS + ' 毫秒）：读结果可以正常覆盖', detailOf('W').row.title)

  clock = CLOCK0 + 2000
  ingest([writeOf('DEL', { row: completeGroup(rowValue('别删我', 'open')) })], { kind: 'read' })
  const delReceipt = ingest([writeOf('DEL', { row: completeGroup(rowValue('刚写完', 'closed')) })], { kind: 'receipt' })
  clock = CLOCK0 + 2100
  ingest([writeOf('DEL', { row: { completeness: 'complete', value: null } })], { kind: 'read', startMergeVersion: Number(delReceipt.mergeVersion) })
  check(detailOf('DEL') !== null && detailOf('DEL').row.title === '刚写完',
    'D9 窗口内的一次「确认不存在」读结果不许把刚写完的票删掉', detailOf('DEL'))

  clock = CLOCK0 + 2500
  const secondReceipt = ingest([writeOf('W', { row: completeGroup(rowValue('第二条回执', 'closed')) })], { kind: 'receipt' })
  check(secondReceipt.committed === true && detailOf('W').row.title === '第二条回执',
    'D10 窗口内的第二次写回执照常生效（回执不被自己的窗口挡）', detailOf('W').row.title)
  clock = CLOCK0 + 2500 + SNAPSHOT_RECEIPT_PRIORITY_MS - 1
  ingest([writeOf('W', { row: completeGroup(rowValue('再迟到', 'open')) })], { kind: 'read' })
  check(detailOf('W').row.title === '第二条回执',
    'D11 第二次回执把窗口起点推到它提交的时刻（不是从第一次算）', detailOf('W').row.title)

  clock = CLOCK0 + 2500
  ingest([writeOf('OTHER', { row: completeGroup(rowValue('别的票', 'open')) })], { kind: 'read' })
  clock = CLOCK0 + 2600
  ingest([writeOf('OTHER', { row: completeGroup(rowValue('别的票-读回来', 'closed')) })], { kind: 'read' })
  check(detailOf('OTHER').row.title === '别的票-读回来',
    'D12 窗口只挡回执表达过的那张票，别的票照常更新', detailOf('OTHER').row.title)

  clock = CLOCK0 + 3000
  ingest([writeOf('V', {
    row: completeGroup(rowValue('写前标题', 'open')),
    body: completeGroup('写前正文'),
  })], { kind: 'read' })
  const versionBeforeV = handle.getMergeVersion()
  const vReceipt = ingest([writeOf('V', {
    row: completeGroup(rowValue('写后标题', 'closed')),
    labels: completeGroup([{ name: 'newer' }]),
  })], { kind: 'receipt' })
  clock = CLOCK0 + 3100
  const staleRead = ingest([writeOf('V', {
    row: completeGroup(rowValue('写前标题', 'open')),
    body: completeGroup('写前正文-迟到'),
  })], { kind: 'read', startMergeVersion: versionBeforeV })
  check(staleRead.committed === false && staleRead.reason === 'stale',
    'D13 起读在写之前的那一趟读结果被版本门整批丢弃', staleRead)
  check(detailOf('V').row.title === '写后标题' && detailOf('V').body !== '写前正文-迟到',
    'D14 被版本门丢弃的那一批一个字段都没写（含回执没表达过的 body）',
    { title: detailOf('V').row.title, body: detailOf('V').body })
  check(Number(vReceipt.mergeVersion) > versionBeforeV, 'D15 写回执本身提交成功并推进了版本', vReceipt.mergeVersion)

  clock = CLOCK0 + 4000
  ingest([writeOf('CM', {
    row: completeGroup(rowValue('评论票', 'open')),
    comments: completeGroup([{ body: '已有评论' }]),
  })], { kind: 'read' })
  const commentReceipt = ingest([writeOf('CM', {
    commentReceipt: { comment: { body: '刚发的评论' }, position: null, completeness: 'complete' },
  } as any)], { kind: 'receipt' })
  clock = CLOCK0 + 4100
  ingest([writeOf('CM', { comments: completeGroup([{ body: '已有评论' }]) })],
    { kind: 'read', startMergeVersion: Number(commentReceipt.mergeVersion) })
  check(detailOf('CM').comments.map((x: any) => x.body).join('|').indexOf('刚发的评论') >= 0,
    'D16 窗口内一整页评论（整组替换）不许冲掉刚发的那一条', detailOf('CM').comments.map((x: any) => x.body))

  // 窗口一过，读结果照常覆盖这一组；刚发的那一条在它自己的位置上（前缀那一页够不到它）。
  clock = CLOCK0 + 4100 + SNAPSHOT_RECEIPT_PRIORITY_MS
  ingest([writeOf('CM', {
    comments: { completeness: 'truncated', value: [{ body: '已有评论（改过）' }] },
  })], { kind: 'read', startMergeVersion: Number(commentReceipt.mergeVersion) })
  const cmComments = detailOf('CM').comments.map((x: any) => x.body).join('|')
  check(cmComments.indexOf('刚发的评论') >= 0 && cmComments.indexOf('已有评论（改过）') >= 0,
    'D17 窗口之后的前缀页照常落库，刚发的那一条仍在（按位置合并，不重叠）', cmComments)

  check(isReceiptWindowActive(null, CLOCK0, SNAPSHOT_RECEIPT_PRIORITY_MS) === false,
    'D18 从没被回执写过的组不受窗口约束')
  check(isReceiptWindowActive(CLOCK0, CLOCK0 + SNAPSHOT_RECEIPT_PRIORITY_MS - 1, SNAPSHOT_RECEIPT_PRIORITY_MS) === true
    && isReceiptWindowActive(CLOCK0, CLOCK0 + SNAPSHOT_RECEIPT_PRIORITY_MS, SNAPSHOT_RECEIPT_PRIORITY_MS) === false,
    'D19 纯判断的边界：窗口内为真、正好满窗口为假')
  check(shouldDeferReadGroup({ receiptMs: CLOCK0, nowMs: CLOCK0 + 1, windowMs: SNAPSHOT_RECEIPT_PRIORITY_MS, group: 'body', completeness: 'unknown' }) === false,
    'D20 unknown（只盖章不动值）的读结果不被挡')
  check(shouldDeferReadGroup({ receiptMs: CLOCK0, nowMs: CLOCK0 + 1, windowMs: SNAPSHOT_RECEIPT_PRIORITY_MS, group: 'comments', completeness: 'truncated' }) === true
    && shouldDeferReadGroup({ receiptMs: CLOCK0, nowMs: CLOCK0 + 1, windowMs: SNAPSHOT_RECEIPT_PRIORITY_MS, group: 'comments', completeness: 'complete' }) === true
    && shouldDeferReadGroup({ receiptMs: CLOCK0, nowMs: CLOCK0 + SNAPSHOT_RECEIPT_PRIORITY_MS, windowMs: SNAPSHOT_RECEIPT_PRIORITY_MS, group: 'comments', completeness: 'truncated' }) === false,
    'D21 评论的两页在窗口内都要让给回执（truncated 也可能盖到刚发的那一条），窗口一过放行')

  // ── E. 窗口长度住在时间参数里 ────────────────────────────────────────────────
  const yamlText = readFileSync(path.join(process.cwd(), 'config', 'ttl.yaml'), 'utf8')
  const yamlMatch = /^\s*snapshotReceiptPriorityMs:\s*(\d+)\s*$/m.exec(yamlText)
  check(!!yamlMatch && Number(yamlMatch[1]) === SNAPSHOT_RECEIPT_PRIORITY_MS,
    'E1 生成的窗口常量就是 config/ttl.yaml 里那一刻（真源在 YAML，不在代码）', yamlMatch && yamlMatch[1])
  const ingestSource = readFileSync(path.join(process.cwd(), 'src', 'workspace-snapshot', 'runtime', 'ingest.ts'), 'utf8')
  check(ingestSource.indexOf('SNAPSHOT_RECEIPT_PRIORITY_MS') >= 0
    && ingestSource.indexOf('shared/time-config/src/values.js') >= 0,
    'E2 摄入事务从中央时间参数取窗口长度（不在代码里写第二份数字）')
  check(SNAPSHOT_RECEIPT_PRIORITY_MS > 0 && SNAPSHOT_RECEIPT_PRIORITY_MS < 60000,
    'E3 窗口是一个「短」窗口（0 < 值 < 60 秒）', SNAPSHOT_RECEIPT_PRIORITY_MS)

  // ── F. 接线：宿主那两条回执路真的按「回执」提交（不是按读结果） ───────────────
  clock = CLOCK0 + 5000
  await recordIssueRows({ ...libKey, rows: [issueOf('F', { title: '宿主旧标题', state: 'open' })] } as any)
  const hostReceipt: any = await recordWriteReceipt({
    ...libKey, issues: [issueOf('F', { title: '宿主新标题', state: 'closed' })], operation: 'close',
  } as any)
  check(hostReceipt && hostReceipt.ok === true, 'F1 宿主门面的写回执提交成功', hostReceipt)
  await recordIssueRows({ ...libKey, rows: [issueOf('F', { title: '宿主旧标题', state: 'open' })] } as any)
  const fDetail: any = await readIssueDetail({ ...libKey, key: 'F', effortId: '' })
  check(fDetail && fDetail.issue && fDetail.issue.row.title === '宿主新标题' && fDetail.issue.row.state === 'closed',
    'F2 紧接着一趟读结果（真时钟，窗口内）没有把门面写进去的值盖回去',
    fDetail && fDetail.issue && { title: fDetail.issue.row.title, state: fDetail.issue.row.state })

  // 评论回执同样按「回执」提交：窗口内整页读结果不许冲掉它。
  clock = CLOCK0 + 5200
  await recordIssueRows({ ...libKey, rows: [issueOf('FC', { title: '评论票', state: 'open', comments: [{ id: 'c1', body: '已有' }] })] } as any)
  const fcReceipt: any = await recordCommentReceipt({ ...libKey, keys: ['FC'], effortId: '', comment: { id: 'c2', body: '面板刚发的' } } as any)
  const fcAfterPage: any = await recordIssueRows({ ...libKey, rows: [issueOf('FC', { title: '评论票', state: 'open', comments: [{ id: 'c1', body: '已有' }] })] } as any)
  const fcDetail: any = await readIssueDetail({ ...libKey, key: 'FC', effortId: '' })
  const fcBodies = fcDetail && fcDetail.issue ? fcDetail.issue.comments.map((c: any) => c.body).join('|') : ''
  check(fcReceipt && fcReceipt.ok === true && fcAfterPage && fcAfterPage.ok === true && fcBodies.indexOf('面板刚发的') >= 0,
    'F3 评论回执在窗口内不被「只有一行」的读结果冲掉（门面确实按回执提交）', fcBodies)

  printGateResult(GATE, total, failed)
}

main().then(() => {
  closeSnapshotLibraries()
  try { handle.close() } catch (e) { /* 句柄可能已被关闭 */ }
  rmSync(root, { recursive: true, force: true })
}).catch((error) => {
  console.log('FAIL 门禁自己抛错：' + String((error && error.stack) || error))
  closeSnapshotLibraries()
  try { handle.close() } catch (e) { /* 句柄可能已被关闭 */ }
  try { rmSync(root, { recursive: true, force: true }) } catch (e) { /* 临时目录删不掉不影响结论 */ }
  printGateResult(GATE, total, failed + 1)
})
