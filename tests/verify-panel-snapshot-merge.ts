/**
 * tests/verify-panel-snapshot-merge.ts —— 快照合并服务门禁（#1690）
 *
 * 守什么：面板快照写入只能走一个纯函数入口（src/refresh/kernel/snapshot-merge.ts），
 * 不再整行替换；合并按字段组、按来源完整度来，过期结果整份丢弃，读写两条路径都不因降级缩数据。
 *
 * 逐条对应票 #1690 的验收：
 *   A 四类结果（新增、修改、删除、保留）各有一例，且 changes 与 counts 能直接断言；
 *   B 字段组掩码：完整来源允许覆盖与清空，截断来源只补空缺不缩，未表达来源整组不动，
 *     行内三态说不认识时压过来源声明；组盖章记下版本/时间/来源/操作；
 *   C 版本门：过期的整份丢弃（快照引用都不换），接受后 merge 版本单调递增；
 *     新字段 snapshot.merge 随信封走，但 snapshotVersionOf（304 语义）一个字节都不读它；
 *   D 只有完整来源允许删除或清空；非完整来源连显式点名都不许删；
 *   E 排序不在存储层做：输入乱序、新增行一律追加到尾部，已有行位置与未变对象引用都不动；
 *   F 读写两条集成路径：完整查询（GraphQL get）之后接降级（REST get），行、父子边、依赖边、
 *     子票计数、已取正文、评论、评审一条不减少；两者都推进合并版本、都不发整池 list。
 *
 * 为什么用真模块跑：这一条守的是合并后的快照事实，换一种等价的合并实现而结论不变时不该误报。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-panel-snapshot-merge.ts
 */
// 门禁归属: src/refresh/kernel/snapshot-merge.ts
// 门禁归属: src/refresh/rooms/host/thin-row-fetch.ts
// 门禁归属: src/refresh/rooms/host/row-patch.ts

import { printGateResult } from './lib/gate-result.ts'
import * as merge from '../src/refresh/kernel/snapshot-merge.ts'
import * as delta from '../src/refresh/kernel/snapshot-diff.ts'
import * as win from '../src/refresh/kernel/index-window-rules.ts'
import { createPatch } from '../src/refresh/rooms/host/row-patch.ts'
import { snapshotVersionOf } from '../src/host/tracker/snapshotVersion.ts'

const GATE = 'verify-panel-snapshot-merge'
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

const CWD = 'C:\\ws\\demo'
const WS = 'ws-demo'
const CLOCK0 = 1700000000000

function row(n: number, extra?: Record<string, unknown>): any {
  const base: any = {
    number: n,
    key: String(n),
    title: '票 ' + n,
    state: 'OPEN',
    updatedAt: '2026-09-20T00:00:00Z',
    labels: [],
    assignees: ['me'],
    author: { login: 'me' },
    createdAt: '2026-09-01T00:00:00Z',
  }
  return extra ? Object.assign(base, extra) : base
}

/** 一组三态：已知写值，未知写 not-expressed（与 contract/field-state.ts 同口径）。 */
function fieldState(known: boolean, value?: unknown): any {
  return known ? { known: true, value: value, reason: null } : { known: false, value: null, reason: 'not-expressed' }
}

/** 六组齐全的三态，覆盖项按组名传进来（契约约定：给了 fieldStates 六组必须齐全）。 */
function statesWith(over?: Record<string, unknown>): any {
  const s: any = {
    parents: fieldState(true, null),
    dependencies: fieldState(true, []),
    subIssues: fieldState(true, { total: 0, completed: 0, percentCompleted: 0 }),
    comments: fieldState(true, 0),
    review: fieldState(true, []),
    mergeInfo: fieldState(true, null),
  }
  return Object.assign(s, over || {})
}

/** 读来源：形状与 contract/read-provenance.ts 一致，门禁只靠 fieldGroups 判完整度。 */
function provenance(opts?: Record<string, any>): any {
  const o: any = opts || {}
  const p: any = {
    operation: o.operation || 'get',
    source: o.source || 'graphql',
    completeness: o.completeness || 'complete',
    fieldGroups: o.fieldGroups || {},
    missingFieldGroups: [],
    durationMs: 4,
    startVersion: 'read-v1-1-000001',
  }
  if (o.degradedFrom) p.degradedFrom = o.degradedFrom
  return p
}

function snapshot(extra?: Record<string, unknown>): any {
  const s: any = {
    ok: true,
    repo: { owner: 'o', name: 'r' },
    workspaceRoot: CWD,
    version: 'v0',
    generatedMs: CLOCK0 - 60000,
    maps: [],
    issues: [],
    labels: [],
    deck: { counts: { open: 0, closed: 0, total: 0 }, partial: false, levels: [] },
    delta: {
      structureVersion: delta.DELTA_STRUCTURE_VERSION,
      watermarkMs: CLOCK0 - 3600000,
      generation: 3,
      pending: [],
      pendingAt: 0,
      pendingReason: '',
    },
    merge: { version: 5, lastStartMs: CLOCK0 - 5000, groups: {} },
  }
  return extra ? Object.assign(s, extra) : s
}

async function main(): Promise<void> {
  console.log('快照合并服务门禁（#1690：四类结果、字段组掩码、版本门、删清判据、顺序、读写两条集成路径）')

  // ===========================================================================
  // A. 四类合并结果：新增、修改、删除、保留
  // ===========================================================================
  const base = snapshot({ issues: [row(1, { title: '旧标题' })] })
  const oldRow1 = base.issues[0]

  const keptOut: any = merge.mergeSnapshot(base, { kind: 'read', startVersion: 5, startedMs: CLOCK0, rows: [row(1, { title: '旧标题' })] })
  check(keptOut.verdict === 'merged' && keptOut.reason === 'nothing-changed', 'A 保留：内容没变也照收，回 nothing-changed（实得 ' + keptOut.verdict + ' / ' + keptOut.reason + '）')
  check(keptOut.changes.kept.join('|') === '1' && keptOut.changes.updated.length === 0, 'A 保留：changes.kept 命中 1，updated 为空（实得 ' + JSON.stringify(keptOut.changes) + '）')
  check(keptOut.snapshot.issues[0] === oldRow1, 'A 保留：没变的那一行仍是原来那个对象（引用原样保留）')

  const updOut: any = merge.mergeSnapshot(base, { kind: 'read', startVersion: 5, startedMs: CLOCK0, rows: [row(1, { title: '新标题' })] })
  check(updOut.changes.updated.join('|') === '1' && updOut.counts.updated === 1, 'A 修改：changes.updated 命中 1，counts.updated 也是 1')
  check(updOut.snapshot.issues[0] !== oldRow1 && updOut.snapshot.issues[0].title === '新标题', 'A 修改：换成了新对象，标题是新的')
  check(updOut.snapshot.issues.length === 1 && updOut.version !== base.version, 'A 修改：行数没变，内容版本号必变（' + base.version + ' → ' + updOut.version + '）')

  const addOut: any = merge.mergeSnapshot(base, { kind: 'write', startVersion: 5, startedMs: CLOCK0, rows: [row(1, { title: '旧标题' }), row(2)], allowNewRows: true })
  check(addOut.changes.added.join('|') === '2' && addOut.counts.added === 1, 'A 新增：changes.added 命中 2（实得 ' + JSON.stringify(addOut.changes) + '）')
  check(addOut.snapshot.issues.length === 2 && addOut.snapshot.issues[1].number === 2, 'A 新增：新行追加在列表尾部')
  check(addOut.snapshot.issues[0] === oldRow1, 'A 新增：旧行位置与引用都没动')

  const missOut: any = merge.mergeSnapshot(base, { kind: 'read', startVersion: 5, startedMs: CLOCK0, rows: [row(9)] })
  check(missOut.changes.added.length === 0 && missOut.missing.join('|') === '9', 'A 新增：读路径不许凭空加行，没见过的键进 missing（实得 ' + JSON.stringify(missOut.missing) + '）')

  const twoRows = snapshot({ issues: [row(1), row(2)] })
  const remOut: any = merge.mergeSnapshot(twoRows, {
    kind: 'read', startVersion: 5, startedMs: CLOCK0, rows: [row(1)], enumeratesAll: true,
    provenance: provenance({ fieldGroups: { row: 'complete' } }),
  })
  check(remOut.changes.removed.join('|') === '2' && remOut.counts.removed === 1, 'A 删除：完整枚举下没出现的 2 被删（实得 ' + JSON.stringify(remOut.changes) + '）')
  check(remOut.snapshot.issues.length === 1 && remOut.snapshot.issues[0] === twoRows.issues[0], 'A 删除：留下的 1 仍是原对象，位置没动')

  // ===========================================================================
  // B. 字段组掩码：完整可覆盖可清空、截断只补不缩、未表达整组不动
  // ===========================================================================
  const b1base = snapshot({ issues: [row(1, { parentKey: '7' })] })
  const b1: any = merge.mergeSnapshot(b1base, {
    kind: 'read', startVersion: 5, startedMs: CLOCK0,
    rows: [row(1, { parentKey: null, fieldStates: statesWith({ parents: fieldState(true, null) }) })],
    provenance: provenance({ fieldGroups: { row: 'complete', parents: 'complete' } }),
  })
  check(b1.snapshot.issues[0].parentKey === null, 'B 完整来源：parents 明确为空时可以把旧父边清成 null（实得 ' + String(b1.snapshot.issues[0].parentKey) + '）')

  const b2base = snapshot({ issues: [row(1, { comments: [{ body: '旧评论' }], commentCount: 1 })] })
  const b2: any = merge.mergeSnapshot(b2base, {
    kind: 'read', startVersion: 5, startedMs: CLOCK0,
    rows: [row(1, { comments: [], commentCount: 0, fieldStates: statesWith({ comments: fieldState(true, 0) }) })],
    provenance: provenance({ fieldGroups: { row: 'complete', comments: 'complete' } }),
  })
  check(b2.snapshot.issues[0].comments.length === 0 && b2.snapshot.issues[0].commentCount === 0, 'B 完整来源：comments 明确为空时旧评论与总数都被清掉')

  const b3base = snapshot({ issues: [row(1, { body: '旧正文', labels: [{ name: 'a' }] })] })
  const b3: any = merge.mergeSnapshot(b3base, {
    kind: 'read', startVersion: 5, startedMs: CLOCK0,
    rows: [row(1, { body: '新正文', labels: [{ name: 'b' }] })],
    provenance: provenance({ fieldGroups: { row: 'complete', body: 'complete', labels: 'complete' } }),
  })
  check(b3.snapshot.issues[0].body === '新正文' && b3.snapshot.issues[0].labels[0].name === 'b', 'B 完整来源：正文与标签可以覆盖旧的')

  const fullOld = row(1, {
    parentKey: '7',
    blockedBy: [{ number: 301, key: '301', state: 'OPEN', title: '前置' }],
    subIssueCounts: { total: 3, completed: 1, percentCompleted: 33 },
    body: '旧正文',
    comments: [{ body: '旧评论' }],
    commentCount: 2,
    reviews: [{ state: 'APPROVED' }],
  })
  const unknownStates = statesWith({
    parents: fieldState(false), dependencies: fieldState(false), subIssues: fieldState(false),
    comments: fieldState(false), review: fieldState(false), mergeInfo: fieldState(false),
  })
  const b4: any = merge.mergeSnapshot(snapshot({ issues: [fullOld] }), {
    kind: 'read', startVersion: 5, startedMs: CLOCK0,
    rows: [row(1, { title: '降级标题', fieldStates: unknownStates })],
    provenance: provenance({
      source: 'rest', completeness: 'partial', degradedFrom: 'graphql',
      fieldGroups: {
        row: 'complete', body: 'unexpressed', labels: 'unexpressed', parents: 'unexpressed',
        dependencies: 'unexpressed', subIssues: 'unexpressed', comments: 'unexpressed',
        review: 'unexpressed', mergeInfo: 'unexpressed',
      },
    }),
  })
  const b4row = b4.snapshot.issues[0]
  check(b4row.parentKey === '7', 'B 未表达来源：父边保留（实得 ' + String(b4row.parentKey) + '）')
  check(b4row.blockedBy.length === 1 && b4row.blockedBy[0].number === 301, 'B 未表达来源：依赖边一条不少')
  check(b4row.subIssueCounts.total === 3 && b4row.subIssueCounts.completed === 1, 'B 未表达来源：子票计数保留')
  check(b4row.body === '旧正文' && b4row.comments.length === 1 && b4row.commentCount === 2, 'B 未表达来源：已取正文与评论原样保留')
  check(b4row.reviews.length === 1, 'B 未表达来源：评审明细保留')
  check(b4row.title === '降级标题', 'B 未表达来源：来源声明完整的行组照常更新（只保未知组）')

  const truncBase = snapshot({ issues: [row(1, {
    blockedBy: [{ number: 300, key: '300', state: 'OPEN', title: '旧前置' }],
    comments: [{ body: '旧评论' }],
    commentCount: 1,
  })] })
  const truncOut: any = merge.mergeSnapshot(truncBase, {
    kind: 'read', startVersion: 5, startedMs: CLOCK0,
    rows: [row(1, {
      blockedBy: [{ number: 302, key: '302', state: 'OPEN', title: '新前置' }],
      comments: [],
      commentCount: 0,
      fieldStates: statesWith({
        dependencies: fieldState(true, [{ number: 302, key: '302', state: 'OPEN', title: '新前置' }]),
        comments: fieldState(true, 0),
      }),
    })],
    provenance: provenance({ fieldGroups: { row: 'complete', dependencies: 'truncated', comments: 'truncated' } }),
  })
  const truncRow = truncOut.snapshot.issues[0]
  check(truncRow.blockedBy.length === 1 && truncRow.blockedBy[0].number === 300, 'B 截断来源：依赖边只补空缺、绝不缩（旧前置还在，实得 ' + JSON.stringify(truncRow.blockedBy) + '）')
  check(truncRow.comments.length === 1 && truncRow.commentCount === 1, 'B 截断来源：评论与总数不缩')

  const gapBase = snapshot({ issues: [row(1, { comments: [], commentCount: 0 })] })
  const gapOut: any = merge.mergeSnapshot(gapBase, {
    kind: 'read', startVersion: 5, startedMs: CLOCK0,
    rows: [row(1, { comments: [{ body: '补进来的' }], commentCount: 1, fieldStates: statesWith({ comments: fieldState(true, 1) }) })],
    provenance: provenance({ fieldGroups: { row: 'complete', comments: 'truncated' } }),
  })
  check(gapOut.snapshot.issues[0].comments.length === 1 && gapOut.snapshot.issues[0].commentCount === 1, 'B 截断来源：旧值是空数组时把新取到的补进来')

  const b5: any = merge.mergeSnapshot(snapshot({ issues: [row(1, { parentKey: '7' })] }), {
    kind: 'read', startVersion: 5, startedMs: CLOCK0,
    rows: [row(1, { parentKey: null, fieldStates: statesWith({ parents: fieldState(false) }) })],
    provenance: provenance({ fieldGroups: { row: 'complete', parents: 'complete' } }),
  })
  check(b5.snapshot.issues[0].parentKey === '7', 'B 行内三态压过来源声明：行里的 parents 说不认识，来源说完整也不许清旧父边')

  const b6base = snapshot({ issues: [row(1, { isPullRequest: true, mergedAt: '2026-09-10T00:00:00Z', url: 'https://x/1', reason: 'completed' })] })
  const b6: any = merge.mergeSnapshot(b6base, {
    kind: 'read', startVersion: 5, startedMs: CLOCK0,
    rows: [row(1, { mergedAt: null, fieldStates: statesWith({ mergeInfo: fieldState(true, null) }) })],
    provenance: provenance({ fieldGroups: { row: 'complete', mergeInfo: 'complete' } }),
  })
  check(b6.snapshot.issues[0].mergedAt === null, 'B 完整来源：mergeInfo 明确没合并时清掉旧合并时间')
  check(b6.snapshot.issues[0].key === '1' && b6.snapshot.issues[0].number === 1, 'B 完整来源：行组覆盖时身份字段（key/number）保留')
  check(!('isPullRequest' in b6.snapshot.issues[0]), 'B 完整来源：行组里来源不再给的字段被清掉（isPullRequest 不在新行里）')
  check(b6.snapshot.issues[0].url === 'https://x/1' && b6.snapshot.issues[0].reason === 'completed', 'B 完整来源：行组之外的字段不归行组管，url/reason 原样保留（不误删）')

  const stampGroup = b1.merge.groups.parents
  check(!!stampGroup && stampGroup.completeness === 'complete', 'B 组盖章：parents 组记下本次完整度（实得 ' + JSON.stringify(stampGroup) + '）')
  check(stampGroup.source === 'graphql' && stampGroup.operation === 'get' && stampGroup.atMs === CLOCK0, 'B 组盖章：来源/操作/读取起点都记下')
  check(stampGroup.version === b1.merge.version && b1.merge.version === 6, 'B 组盖章：版本号跟着合并版本走（' + b1.merge.version + '）')

  // ===========================================================================
  // C. 版本门与 304：过期整份丢弃、版本单调、新字段不参与 etag
  // ===========================================================================
  const gateBase = snapshot({ issues: [row(1)] })
  const staleOut: any = merge.mergeSnapshot(gateBase, { kind: 'read', startVersion: 4, startedMs: CLOCK0, rows: [row(1, { title: '迟到的' })] })
  check(staleOut.verdict === 'stale-dropped' && staleOut.reason === 'stale-result', 'C 版本门：起读版本比当前旧 → 整份丢弃（实得 ' + staleOut.verdict + ' / ' + staleOut.reason + '）')
  check(staleOut.snapshot === gateBase, 'C 版本门：丢弃时连快照对象都不换')
  check(staleOut.merge.version === 5 && staleOut.version === gateBase.version, 'C 版本门：合并版本与内容版本都一个字不动')
  check(staleOut.changes.added.length === 0 && staleOut.changes.updated.length === 0 && staleOut.changes.removed.length === 0 && staleOut.changes.kept.length === 0, 'C 版本门：丢弃时四类计数全空')

  const acc1: any = merge.mergeSnapshot(gateBase, { kind: 'read', startVersion: 5, startedMs: CLOCK0, rows: [row(1)] })
  check(acc1.verdict === 'merged' && acc1.merge.version === 6, 'C 版本门：起读版本等于当前 → 接受，合并版本 +1（实得 ' + acc1.merge.version + '）')
  const acc2: any = merge.mergeSnapshot(acc1.snapshot, { kind: 'read', startVersion: 6, startedMs: CLOCK0 + 1000, rows: [row(1)] })
  check(acc2.merge.version === 7 && acc2.merge.lastStartMs === CLOCK0 + 1000, 'C 版本门：连续合并单调递增，并记下本次读取起点')
  const stale2: any = merge.mergeSnapshot(acc2.snapshot, { kind: 'read', startVersion: 5, startedMs: CLOCK0 + 2000, rows: [row(1)] })
  check(stale2.verdict === 'stale-dropped' && stale2.merge.version === 7, 'C 版本门：更新落地之后，旧起读版本的结果照样被丢')

  check(merge.mergeVersionOf({ issues: [] }) === 0, 'C 兼容：老快照没有 merge 字段 → 合并版本按 0 起算')
  check(merge.mergeVersionOf({ merge: { version: 9 } }) === 9, 'C 兼容：有 merge 字段 → 读出持久化的合并版本')
  const legacyState = merge.mergeStateOf({})
  check(legacyState.version === 0 && legacyState.lastStartMs === 0 && typeof legacyState.groups === 'object', 'C 兼容：坏值/缺失都归到空状态，不抛错')

  const noMergeSnap = snapshot({ issues: [row(1), row(2)] })
  delete noMergeSnap.merge
  const withMergeSnap = snapshot({ issues: [row(1), row(2)] })
  withMergeSnap.merge = { version: 42, lastStartMs: 123, groups: { row: { version: 42, atMs: 123, source: 'graphql', operation: 'get', completeness: 'complete' } } }
  check(snapshotVersionOf(withMergeSnap) === snapshotVersionOf(noMergeSnap), 'C 304 语义：内容散列（etag）不读 snapshot.merge，合并簿记不进版本号')
  check(merge.mergeSnapshot(noMergeSnap, { kind: 'read', startVersion: 0, startedMs: CLOCK0, rows: [row(1), row(2)] }).snapshot.version === noMergeSnap.version, 'C 信封契约版本 snapshot.version 不被合并服务改写')

  // ===========================================================================
  // D. 只有完整来源允许删除或清空
  // ===========================================================================
  const dTwo = snapshot({ issues: [row(1), row(2)] })
  const notEnumerated: any = merge.mergeSnapshot(dTwo, { kind: 'read', startVersion: 5, startedMs: CLOCK0, rows: [row(1)] })
  check(notEnumerated.snapshot.issues.length === 2 && notEnumerated.changes.removed.length === 0, 'D 删清：没声明「枚举了全部」就不许删（两行都在）')

  const truncEnum: any = merge.mergeSnapshot(dTwo, {
    kind: 'read', startVersion: 5, startedMs: CLOCK0, rows: [row(1)], enumeratesAll: true,
    provenance: provenance({ fieldGroups: { row: 'truncated' } }),
  })
  check(truncEnum.snapshot.issues.length === 2 && truncEnum.changes.removed.length === 0, 'D 删清：行组只是截断（没取全）就不许删')

  const explicitNo: any = merge.mergeSnapshot(dTwo, { kind: 'write', startVersion: 5, startedMs: CLOCK0, rows: [], removedKeys: ['2'] })
  check(explicitNo.snapshot.issues.length === 2 && explicitNo.changes.removed.length === 0, 'D 删清：没有完整来源证据，显式点名删除也不执行')

  const explicitOk: any = merge.mergeSnapshot(dTwo, {
    kind: 'write', startVersion: 5, startedMs: CLOCK0, rows: [row(1)], removedKeys: ['2'], completeness: 'complete',
  })
  check(explicitOk.changes.removed.join('|') === '2' && explicitOk.snapshot.issues.length === 1, 'D 删清：完整来源下，显式点名的那一行被删掉')

  // ===========================================================================
  // E. 排序不在存储层：输入乱序也不动位置，新增只许追加到尾部
  // ===========================================================================
  const ordBase = snapshot({ issues: [
    row(1, { updatedAt: '2026-09-20T00:00:00Z' }),
    row(2, { updatedAt: '2026-09-19T00:00:00Z' }),
    row(3, { updatedAt: '2026-09-18T00:00:00Z' }),
  ] })
  const ordOut: any = merge.mergeSnapshot(ordBase, {
    kind: 'write', startVersion: 5, startedMs: CLOCK0,
    rows: [row(3, { title: '三改' }), row(1, { title: '一改' }), row(4)],
    allowNewRows: true,
  })
  check(ordOut.snapshot.issues.map((r: any) => r.number).join(',') === '1,2,3,4', 'E 顺序：已有行位置一律不动，新行追加在尾部（实得 ' + ordOut.snapshot.issues.map((r: any) => r.number).join(',') + '）')
  check(ordOut.snapshot.issues[1] === ordBase.issues[1], 'E 顺序：没并到的行对象原样保留')
  check(ordOut.snapshot.issues[0].title === '一改' && ordOut.snapshot.issues[2].title === '三改', 'E 顺序：并到的行就地换内容，不因更新更晚而挤到前面')

  // ===========================================================================
  // F. 读写两条集成路径：完整查询之后接降级，关系一条不减少
  // ===========================================================================
  let store: any = null
  let writes = 0
  const gets: string[] = []
  const responses: any[] = []
  let listCalls = 0
  let windowIndex: any = null
  let clock = CLOCK0

  function relatedRow(n: number, extra?: Record<string, unknown>): any {
    return row(n, Object.assign({
      parentKey: '100',
      blockedBy: [{ number: 301, key: '301', state: 'OPEN', title: '前置票 301' }],
      subIssueCounts: { total: 3, completed: 1, percentCompleted: 33 },
      body: '旧正文',
      comments: [{ body: '老评论一' }],
      commentCount: 1,
      reviews: [{ state: 'APPROVED' }],
    }, extra || {}))
  }

  function freshSnapshot(): any {
    const child = relatedRow(201, { title: '子票 201' })
    return snapshot({
      version: 'v0',
      maps: [{
        number: 100, key: '100', state: 'OPEN', title: '地图 100', updatedAt: '2026-09-17T00:00:00Z',
        stats: { total: 3, completed: 1, percentCompleted: 33 },
        tickets: [child],
      }],
      issues: [child, row(205, { title: '另一张票' })],
      deck: { counts: { open: 2, closed: 0, total: 2 }, partial: false, levels: [] },
      merge: { version: 5, lastStartMs: CLOCK0 - 5000, groups: {} },
    })
  }

  const session = {
    list: async function (): Promise<any> { listCalls += 1; return { ok: true, data: [] } },
    listPage: async function (): Promise<any> { return { ok: true, data: { items: [], nextCursor: null, total: 0 } } },
    get: async function (ref: any, k: any): Promise<any> {
      gets.push(String(k))
      const r = responses.shift()
      return r || { ok: false, error: { kind: 'network', message: '门禁没有预置回包' } }
    },
    getDependencies: async function (): Promise<any> { return { ok: true, data: { blockedBy: [], blocking: [] } } },
    listSubIssues: async function (): Promise<any> { return { ok: true, data: { items: [], total: 0, fetched: 0, capped: false, missing: [], dropped: [] } } },
  }
  const openSession = async function (): Promise<any> {
    return { ok: true, backendId: 'github', budget: {}, call: function (fn: any) { return fn(session, { cwd: CWD, caller: 'refresh' }) } }
  }
  const patch = createPatch({
    now: () => clock,
    logCtx: { isEnabled: () => false, fire: () => undefined },
    workspaceKeyOf: () => WS,
    readSnapshot: async () => store,
    writeSnapshot: async (cwd: any, snap: any) => { writes += 1; store = snap },
    indexOfSnapshot: win.indexFromSnapshot,
    windowRules: win,
    getRepoKey: async () => ({ owner: 'o', name: 'r' }),
    probeIndex: async () => ({ ok: true, index: windowIndex }),
    openSession: openSession,
    decide: () => ({ verdict: 'send' }),
  })

  function detailData(extra: Record<string, unknown>): any {
    const d: any = {
      key: '201', effortId: '100', type: 'issue', title: '子票 201 改', state: 'OPEN', body: '完整正文', url: '',
      createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z', closedAt: null,
      parentKey: '100', labels: [], assignees: [{ login: 'me' }], author: { login: 'me' },
      blockedBy: [{ number: 301, key: '301', state: 'OPEN', title: '前置票 301' }],
      comments: [{ body: '新评论' }], commentCount: 3,
      isPullRequest: false, mergedAt: null, reviews: [{ state: 'APPROVED' }],
    }
    return Object.assign(d, extra)
  }

  const completeDetail: any = {
    ok: true,
    data: detailData({
      fieldStates: statesWith({
        parents: fieldState(true, '100'),
        dependencies: fieldState(true, [{ number: 301, key: '301', state: 'OPEN', title: '前置票 301' }]),
        subIssues: fieldState(true, { total: 3, completed: 1, percentCompleted: 33 }),
        comments: fieldState(true, 3),
        review: fieldState(true, [{ state: 'APPROVED' }]),
        mergeInfo: fieldState(true, null),
      }),
    }),
    provenance: provenance({
      fieldGroups: {
        row: 'complete', body: 'complete', comments: 'complete', parents: 'complete',
        dependencies: 'complete', subIssues: 'unexpressed', review: 'unexpressed', mergeInfo: 'unexpressed',
      },
    }),
  }
  const degradedDetail: any = {
    ok: true,
    data: detailData({
      updatedAt: '2026-09-25T00:00:00Z',
      parentKey: null,
      blockedBy: [],
      comments: [],
      reviews: [],
      fieldStates: statesWith({
        parents: fieldState(false), dependencies: fieldState(false), subIssues: fieldState(false),
        comments: fieldState(false), review: fieldState(false), mergeInfo: fieldState(true, null),
      }),
    }),
    provenance: provenance({
      source: 'rest', completeness: 'partial', degradedFrom: 'graphql',
      fieldGroups: {
        row: 'complete', body: 'complete', labels: 'unexpressed', parents: 'unexpressed',
        dependencies: 'unexpressed', subIssues: 'unexpressed', comments: 'unexpressed',
        review: 'unexpressed', mergeInfo: 'complete',
      },
    }),
  }

  store = freshSnapshot()
  const row205Before = store.issues[1]

  // ---- F1 读路径：完整查询（GraphQL get）先落到快照 ----
  windowIndex = { '201': 'OPEN|2026-09-24T00:00:00Z', '205': 'OPEN|2026-09-20T00:00:00Z' }
  responses.push(completeDetail)
  const r1: any = await patch.run(CWD)
  check(r1.mode === 'patch' && r1.rows.join('|') === '201', 'F 读路径：只补变的那一条并成功（实得 ' + r1.mode + ' / ' + JSON.stringify(r1.rows) + '）')
  check(gets.length === 1 && gets[0] === '201' && listCalls === 0, 'F 读路径：只发一条薄查询，整池 list 一次没发（get ' + JSON.stringify(gets) + ' / list ' + listCalls + '）')
  check(store.issues[0].title === '子票 201 改' && store.issues[0].body === '完整正文', 'F 读路径：完整来源的行组与正文都换新了')
  check(store.issues[0].commentCount === 3 && store.issues[0].comments.length === 1, 'F 读路径：评论总数与评论正文都进来了')
  check(store.issues[1] === row205Before, 'F 读路径：没变的那一行引用原样保留')
  check(store.maps[0].tickets.length === 1 && store.maps[0].stats.total === 3, 'F 读路径：地图子票行与子票计数都没动')
  const mv1 = merge.mergeVersionOf(store)
  check(mv1 === 6, 'F 读路径：合并版本经版本门推进到 6（实得 ' + mv1 + '）')

  // ---- F2 读路径：降级来源（REST get）接在完整查询之后，关系一条不减少 ----
  const beforeDegraded = {
    parentKey: store.issues[0].parentKey,
    deps: store.issues[0].blockedBy,
    subIssues: store.issues[0].subIssueCounts,
    body: store.issues[0].body,
    comments: store.issues[0].comments,
    commentCount: store.issues[0].commentCount,
    reviews: store.issues[0].reviews,
    rowCount: store.issues.length,
    mapTickets: store.maps[0].tickets.length,
    mapStats: store.maps[0].stats,
  }
  clock += 60000
  windowIndex = { '201': 'OPEN|2026-09-25T00:00:00Z', '205': 'OPEN|2026-09-20T00:00:00Z' }
  responses.push(degradedDetail)
  const r2: any = await patch.run(CWD)
  check(r2.mode === 'patch' && r2.rows.join('|') === '201', 'F 读路径降级：降级结果照样并进快照（实得 ' + r2.mode + ' / ' + JSON.stringify(r2.rows) + '）')
  check(store.issues[0].parentKey === '100', 'F 读路径降级：父子边没被未表达的来源清掉（实得 ' + String(store.issues[0].parentKey) + '）')
  check(store.issues[0].blockedBy.length === 1 && store.issues[0].blockedBy[0].number === 301, 'F 读路径降级：依赖边一条不减少')
  check(store.issues[0].subIssueCounts.total === 3 && store.issues[0].subIssueCounts.completed === beforeDegraded.subIssues.completed, 'F 读路径降级：子票计数（行上）没被清零')
  check(store.issues[0].body === '完整正文' && store.issues[0].body.length > 0, 'F 读路径降级：已取正文没被清空')
  check(store.issues[0].comments.length === beforeDegraded.comments.length && store.issues[0].commentCount === 3, 'F 读路径降级：评论正文与总数一条不减少')
  check(store.issues[0].reviews.length === 1, 'F 读路径降级：评审明细一条不减少')
  check(store.issues.length === beforeDegraded.rowCount && store.maps[0].tickets.length === beforeDegraded.mapTickets, 'F 读路径降级：行数与地图子票行数一条不减少')
  check(JSON.stringify(store.maps[0].stats) === JSON.stringify(beforeDegraded.mapStats), 'F 读路径降级：地图上的子票计数原样保留')
  check(merge.mergeVersionOf(store) === 7, 'F 读路径降级：版本门推进到 7（实得 ' + merge.mergeVersionOf(store) + '）')

  // ---- F3 写路径：降级来源接在完整查询之后，关系同样一条不减少 ----
  const beforeWrite = {
    parentKey: store.issues[0].parentKey,
    deps: store.issues[0].blockedBy,
    subIssues: store.issues[0].subIssueCounts,
    body: store.issues[0].body,
    comments: store.issues[0].comments,
    commentCount: store.issues[0].commentCount,
    reviews: store.issues[0].reviews,
    rowCount: store.issues.length,
    mapTickets: store.maps[0].tickets.length,
    mapStats: store.maps[0].stats,
    watermarkMs: store.delta.watermarkMs,
  }
  clock += 60000
  const writeDegraded: any = JSON.parse(JSON.stringify(degradedDetail))
  writeDegraded.data.updatedAt = '2026-09-26T00:00:00Z'
  responses.push(writeDegraded)
  const w1: any = await patch.patchTickets(CWD, ['201'])
  check(w1.mode === 'patch' && w1.reason === 'write-patch' && w1.rows.join('|') === '201', 'F 写路径：写事件只补点名的那一条（实得 ' + w1.mode + ' / ' + w1.reason + ' / ' + JSON.stringify(w1.rows) + '）')
  check(store.issues[0].parentKey === '100', 'F 写路径降级：父子边没被未表达的来源清掉')
  check(store.issues[0].blockedBy.length === 1 && store.issues[0].blockedBy[0].number === 301, 'F 写路径降级：依赖边一条不减少')
  check(store.issues[0].subIssueCounts.total === 3, 'F 写路径降级：子票计数（行上）没被清零')
  check(store.issues[0].body === '完整正文', 'F 写路径降级：已取正文没被清空')
  check(store.issues[0].comments.length === beforeWrite.comments.length && store.issues[0].commentCount === 3, 'F 写路径降级：评论正文与总数一条不减少')
  check(store.issues[0].reviews.length === 1, 'F 写路径降级：评审明细一条不减少')
  check(store.issues.length === beforeWrite.rowCount && store.maps[0].tickets.length === beforeWrite.mapTickets, 'F 写路径降级：行数与地图子票行数一条不减少')
  check(JSON.stringify(store.maps[0].stats) === JSON.stringify(beforeWrite.mapStats), 'F 写路径降级：地图上的子票计数原样保留')
  check(store.delta.watermarkMs === beforeWrite.watermarkMs, 'F 写路径：写事件不动水印（' + beforeWrite.watermarkMs + ' → ' + store.delta.watermarkMs + '）')
  check(merge.mergeVersionOf(store) === 8, 'F 写路径降级：版本门推进到 8（实得 ' + merge.mergeVersionOf(store) + '）')
  check(writes >= 3 && listCalls === 0, 'F 两条路径都只写快照、都没发整池 list（写 ' + writes + ' 次 / list ' + listCalls + ' 次）')

  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 快照合并服务门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e: any) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
